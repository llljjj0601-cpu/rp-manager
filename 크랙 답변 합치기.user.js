// ==UserScript==
// @name         크랙 답변 합치기
// @namespace    local.crack.answer-merge
// @version      1.0.3
// @description  이어진 AI 답변 사이의 + 버튼 · 연결 지점 표시 · 서버 저장 확인 후 합치기
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PREFIX = 'crack-answer-merge:v1:';
    const GENERATING = new Set(['generating', 'streaming', 'pending', 'processing']);
    const joinText = (first, second) => first + '\n\n' + second;
    const answer = row => row && row.role === 'assistant' && row.variants === 1 && !GENERATING.has(row.status);

    function boundaryFor(job) {
        if (Object.hasOwn(job, 'boundary')) return Number.isInteger(job.boundary) && job.boundary >= 0 && job.boundary <= job.desired.length ? job.boundary : null;
        const first = job.originals[0].content, second = job.originals.at(-1).content;
        if (job.desired === joinText(first, second)) return first.length + 2;
        const at = second ? job.desired.indexOf(second) : -1;
        return at >= 0 && job.desired.lastIndexOf(second) === at ? at : null;
    }
    function moveBoundary(before, after, offset) {
        if (offset === null || before === after) return offset;
        let start = 0, beforeEnd = before.length, afterEnd = after.length;
        while (start < Math.min(beforeEnd, afterEnd) && before[start] === after[start]) start++;
        while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd--; afterEnd--; }
        if (start >= offset) return offset;
        return beforeEnd <= offset ? offset + afterEnd - beforeEnd : null;
    }

    function findPairs(rows) {
        const pairs = [];
        for (let i = 0; i < rows.length - 1; i++) {
            if (!answer(rows[i])) continue;
            if (answer(rows[i + 1])) pairs.push(rows.slice(i, i + 2));
            else if (rows[i + 1]?.role === 'user' && (rows[i + 1].commandOnly || rows[i + 1].hasContinuationCommand) && rows[i + 1].variants === 1 && answer(rows[i + 2]))
                pairs.push(rows.slice(i, i + 3));
        }
        return pairs;
    }

    // The server has no known atomic merge operation. Re-read before each step;
    // a saved job resumes from actual server contents rather than appending again.
    async function mergeVerified(job, api) {
        const originals = job.originals;
        const first = originals[0];
        const same = (current, original) => current && current.role === original.role && current.content === original.content;
        const read = async id => { api.check(); const value = await api.read(id); api.check(); return value; };
        const changed = () => new Error('원문이 바뀌었거나 대상을 확인하지 못했어요. 추가 변경을 멈췄어요.');
        if (!Array.isArray(originals) || originals.length < 2 || originals.length > 3 || first.role !== 'assistant' ||
            originals.at(-1).role !== 'assistant' || new Set(originals.map(x => x.id)).size !== originals.length ||
            typeof job.desired !== 'string' || !job.desired.trim()) throw changed();
        if (originals.length === 3 && (originals[1].role !== 'user' || !(originals[1].commandOnly || originals[1].hasContinuationCommand))) throw changed();
        const preserved = originals.filter(m => m.role === 'user' && !m.commandOnly);
        const checkPreserved = async () => {
            for (const original of preserved) if (!same(await read(original.id), original)) throw changed();
        };
        const destination = await read(first.id);
        const saved = destination && destination.role === 'assistant' && destination.content === job.desired;
        if (!saved && !same(destination, first)) throw changed();
        for (const original of originals.slice(1)) {
            const current = await read(original.id);
            if ((!current && (!saved || preserved.includes(original))) || (current && !same(current, original))) throw changed();
        }
        api.checkpoint(job);
        if (!saved) {
            api.check();
            let saveError;
            try { await api.update(first.id, first.content, job.desired); } catch (error) { saveError = error; }
            const current = await read(first.id);
            if (!current || current.content !== job.desired || current.role !== 'assistant')
                throw new Error('합친 내용의 서버 저장을 확인하지 못했어요. 뒷 답변은 지우지 않았어요.' + (saveError ? ' ' + saveError.message : ''));
        }
        // Remove the duplicated answer before its continuation-only command.
        for (const original of originals.slice(1).filter(m => !preserved.includes(m)).reverse()) {
            await checkPreserved();
            const currentDestination = await read(first.id);
            if (!currentDestination || currentDestination.role !== 'assistant' || currentDestination.content !== job.desired) throw changed();
            const current = await read(original.id);
            if (!current) continue;
            if (!same(current, original)) throw changed();
            api.check();
            let deleteError;
            try { await api.remove(original.id); } catch (error) { deleteError = error; }
            if (await read(original.id))
                throw new Error('합친 내용은 저장됐지만 중복 메시지 정리가 끝나지 않았어요. 다시 누르면 남은 단계만 진행해요.' + (deleteError ? ' ' + deleteError.message : ''));
        }
        const final = await read(first.id);
        if (!final || final.role !== 'assistant' || final.content !== job.desired) throw changed();
        await checkPreserved();
        api.checkpoint({ ...job, complete: true });
        job.complete = true;
    }

    const roomId = () => /^\/(?:stories\/[^/]+\/episodes|characters\/[^/]+\/chats|u\/[^/]+\/c)\/([^/?#]+)/.exec(location.pathname)?.[1] || '';
    const fiberOf = element => { const key = Object.keys(element).find(k => k.startsWith('__reactFiber$')); return key ? element[key] : null; };
    const messageObject = v => v && typeof v === 'object' && typeof v._id === 'string' && typeof v.content === 'string' && typeof v.role === 'string';
    function messageOf(group) {
        const stack = [[fiberOf(group)?.child, 0]];
        for (let n = 0; stack.length && n < 300; n++) {
            const [fiber, depth] = stack.pop();
            if (!fiber) continue;
            let hook = fiber.memoizedState;
            for (let i = 0; hook && typeof hook === 'object' && 'next' in hook && i < 40; i++, hook = hook.next) {
                const value = hook.memoizedState;
                if (messageObject(value)) return value;
                if (Array.isArray(value) && messageObject(value[0])) return value[0];
            }
            if (fiber.sibling) stack.push([fiber.sibling, depth]);
            if (fiber.child && depth < 6) stack.push([fiber.child, depth + 1]);
        }
        return null;
    }
    function variantsOf(group, id) {
        const stack = [[fiberOf(group)?.child, 0]];
        for (let n = 0; stack.length && n < 500; n++) {
            const [fiber, depth] = stack.pop();
            if (!fiber) continue;
            const ids = fiber.memoizedProps?.messageIds;
            if (Array.isArray(ids) && ids.includes(id)) return ids.length;
            if (fiber.sibling) stack.push([fiber.sibling, depth]);
            if (fiber.child && depth < 14) stack.push([fiber.child, depth + 1]);
        }
        const compare = Array.from(group.querySelectorAll('button')).map(b => /^답변\s*비교\s*\d+\s*\/\s*(\d+)$/.exec(b.textContent.trim())).find(Boolean);
        return compare ? Number(compare[1]) : 1;
    }
    function chatContext() {
        const list = document.querySelector('.flex-col-reverse > [data-message-group-id]')?.parentElement;
        if (!list) return null;
        const out = { list, actions: null, state: null, store: null };
        let fiber = fiberOf(list);
        for (let i = 0; fiber && i < 45; i++, fiber = fiber.return) {
            const value = fiber.memoizedProps?.value;
            if (!value || typeof value !== 'object') continue;
            if (typeof value.updateMessage === 'function' && typeof value.removeMessage === 'function' && typeof value.resyncMessage === 'function') out.actions = value;
            else if (typeof value.status === 'string' && 'selectedMessageId' in value && 'chatId' in value) out.state = value;
            else if (typeof value.getState === 'function' && typeof value.subscribe === 'function') {
                const state = value.getState();
                if (state?.messages instanceof Map) out.store = value;
            }
        }
        return out.state?.chatId === roomId() && out.actions && out.store ? out : null;
    }
    function rowsFor(context) {
        const messages = context.store.getState().messages;
        return Array.from(context.list.children).filter(g => g.hasAttribute('data-message-group-id')).reverse().map(group => {
            const visible = messageOf(group);
            const message = visible && messages.get(visible._id);
            if (!message || message.content !== visible.content || message.role !== visible.role) return null;
            const markdown = group.querySelector('.wrtn-markdown');
            const hasContinuationCommand = message.role === 'user' && Array.from(markdown?.querySelectorAll('.slash-command-chip') || []).some(chip => chip.textContent.trim() === '/크래커낭비방지');
            const commandOnly = message.role === 'user' && soleCommand(markdown, group);
            return { id: message._id, role: message.role, content: message.content, status: message.status,
                groupId: group.getAttribute('data-message-group-id'), commandOnly: !!commandOnly, hasContinuationCommand, variants: variantsOf(group, message._id) };
        });
    }
    function soleCommand(markdown, group) {
        if (!markdown || group.querySelector('img,video,audio,picture,iframe,object,embed,canvas,input[type="file"]')) return false;
        const chips = markdown.querySelectorAll('.slash-command-chip');
        if (chips.length !== 1 || chips[0].textContent.trim() !== '/크래커낭비방지') return false;
        const nodes = Array.from(markdown.childNodes);
        while (nodes.length) {
            const node = nodes.pop();
            if (node === chips[0]) continue;
            if (node.nodeType === 3 && !node.textContent.trim()) continue;
            if (node.nodeType !== 1 || !['P', 'DIV', 'SPAN', 'BR'].includes(node.tagName)) return false;
            nodes.push(...node.childNodes);
        }
        return true;
    }
    const pendingKey = chat => PREFIX + 'pending:' + chat;
    const pendingInMemory = new Map();
    function storedPending(name, chat) {
        try { return globalThis[name]?.getItem(pendingKey(chat)) || ''; } catch (_) { return ''; }
    }
    function pendingJob(chat) {
        const raw = storedPending('localStorage', chat) || storedPending('sessionStorage', chat);
        const job = raw ? JSON.parse(raw) : pendingInMemory.get(chat);
        if (!job) return null;
        if (job.chat !== chat || !Array.isArray(job.originals) || !job.originals.length) throw new Error('이 방의 합치기 기록을 읽지 못했어요.');
        return job;
    }
    function clearPending(chat) {
        pendingInMemory.delete(chat);
        for (const name of ['localStorage', 'sessionStorage']) {
            try { globalThis[name]?.removeItem(pendingKey(chat)); } catch (_) { /* Storage is optional. */ }
        }
    }
    function checkpoint(job) {
        const previous = pendingJob(job.chat);
        if (!job.operationId || (previous && previous.operationId !== job.operationId)) throw new Error('다른 합치기 작업이 남아 있어요. 먼저 그 작업을 마무리해 주세요.');
        if (job.complete) { clearPending(job.chat); return; }
        const raw = JSON.stringify(job);
        pendingInMemory.set(job.chat, JSON.parse(raw));
        // Retain only unfinished work. A full or unavailable storage must not block merging.
        for (const name of ['sessionStorage', 'localStorage']) {
            try { globalThis[name]?.setItem(pendingKey(job.chat), raw); } catch (_) { /* Current-tab recovery remains available in memory. */ }
        }
    }
    function abandonPending(job) {
        const previous = pendingJob(job.chat);
        if (!previous || previous.operationId !== job.operationId) throw new Error('진행 기록이 바뀌었어요. 창을 닫고 다시 확인해 주세요.');
        clearPending(job.chat);
    }
    async function withRoomLock(job, action) {
        if (!navigator.locks?.request) throw new Error('여러 탭의 동시 수정을 막을 수 없는 브라우저예요. 최신 Chrome에서 사용해 주세요.');
        return navigator.locks.request(PREFIX + 'room:' + job.chat, { ifAvailable: true }, async lock => {
            if (!lock) throw new Error('다른 탭에서 이 방의 답변을 합치고 있어요. 그 작업이 끝난 뒤 눌러 주세요.');
            const previous = pendingJob(job.chat);
            if (previous && previous.operationId !== job.operationId) throw new Error('다른 합치기 작업이 남아 있어요. 먼저 그 작업을 마무리해 주세요.');
            return action();
        });
    }
    const cookie = name => {
        const value = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
        return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
    };
    async function readServer(chat, id) {
        const token = cookie('access_token');
        if (!token) throw new Error('로그인을 확인하고 새로고침해 주세요.');
        const headers = { Authorization: 'Bearer ' + token, platform: 'web' };
        const wid = cookie('__w_id');
        if (wid) headers['x-wrtn-id'] = wid;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch('https://crack-api.wrtn.ai/crack-gen/v3/chats/' + encodeURIComponent(chat) + '/messages/' + encodeURIComponent(id),
                { headers, cache: 'no-store', signal: controller.signal });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error('서버 확인 실패 · HTTP ' + response.status);
            const data = await response.json();
            if (data.result && !['SUCCESS', 'success'].includes(data.result)) throw new Error('서버가 메시지 조회를 승인하지 않았어요.');
            const message = data.data ?? data;
            if (String(message?._id || message?.id || '') !== id) throw new Error('서버 메시지 ID를 확인하지 못했어요.');
            if (message.deletedAt) return null;
            if (typeof message.content !== 'string' || !['assistant', 'user'].includes(message.role)) throw new Error('서버 원문 형식을 확인하지 못했어요.');
            if (GENERATING.has(message.status)) throw new Error('답변 생성이 끝난 뒤 눌러 주세요.');
            return { id, role: message.role, content: message.content };
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('서버 확인 시간이 초과됐어요. 현재 창에서 다시 확인해 주세요.');
            throw error;
        } finally { clearTimeout(timer); }
    }

    let busy = false, preparing = false, dialog = null, modalJob = null, timer = 0, previewValue = '';
    const getGroup = id => Array.from(document.querySelectorAll('.flex-col-reverse > [data-message-group-id]')).find(g => g.getAttribute('data-message-group-id') === id);
    function guard(job) {
        if (location.pathname !== job.path || roomId() !== job.chat) throw new Error('대화방이 바뀌어 작업을 멈췄어요. 원래 방에서 마무리해 주세요.');
        const context = chatContext();
        if (!context || context.state.status !== 'IDLE') throw new Error('답변 생성이 끝나고 대화 화면이 준비된 뒤 눌러 주세요.');
        if (context.list.querySelector('.tiptap.ProseMirror:not(.__chat_input_textarea)')) throw new Error('열려 있는 메시지 수정창을 먼저 닫아 주세요.');
        return context;
    }
    function createAdapter(job) {
        const context = guard(job);
        const targets = new Set(job.originals.filter(m => m.role === 'assistant' || m.commandOnly).map(m => m.id));
        const unaffected = new Map(Array.from(context.store.getState().messages).filter(([id]) => !targets.has(id)).map(([id, m]) => [id, { content: m.content, role: m.role }]));
        return {
            check() {
                const current = guard(job);
                const messages = current.store.getState().messages;
                const others = Array.from(messages.keys()).filter(id => !targets.has(id));
                if (others.length !== unaffected.size || others.some(id => !unaffected.has(id) || unaffected.get(id).content !== messages.get(id).content || unaffected.get(id).role !== messages.get(id).role))
                    throw new Error('다른 대화가 추가되거나 변경돼 작업을 멈췄어요. 상태를 확인한 뒤 마무리해 주세요.');
                for (const original of job.originals) {
                    const group = getGroup(original.groupId);
                    if (group && (messageOf(group)?._id !== original.id || variantsOf(group, original.id) !== 1))
                        throw new Error('선택된 답변 또는 답변 후보가 바뀌어 작업을 멈췄어요.');
                }
            },
            read: id => readServer(job.chat, id),
            async update(id, content, desired) {
                const current = guard(job);
                const message = current.store.getState().messages.get(id);
                if (!message || message.content !== content) throw new Error('화면의 원문이 달라졌어요. 새로고침한 뒤 확인해 주세요.');
                await current.actions.updateMessage({ _id: id, content }, desired);
            },
            async remove(id) {
                const current = guard(job);
                await current.actions.removeMessage(id);
                if (guard(job).store.getState().messages.has(id)) throw new Error('크랙 화면에 메시지가 남아 있어요.');
            },
            checkpoint
        };
    }
    function status(text) { if (dialog) dialog.querySelector('[data-status]').textContent = text; }
    function showBoundary() {
        if (!dialog || !modalJob) return;
        const preview = dialog.querySelector('textarea'), at = modalJob.boundary;
        const known = Number.isInteger(at);
        dialog.querySelector('[data-before]').textContent = known ? preview.value.slice(Math.max(0, at - 150), at).trimEnd() : '';
        dialog.querySelector('[data-boundary-label]').textContent = known ? '▼ 여기부터 이어진 답변' : '본문 수정으로 연결 위치를 특정할 수 없어요';
        dialog.querySelector('[data-after]').textContent = known ? preview.value.slice(at, at + 150).replace(/\n\s*\n/g, '\n') : '';
        dialog.querySelector('[data-jump]').disabled = !known;
        const before = dialog.querySelector('[data-before]'); before.scrollTop = before.scrollHeight;
    }
    function jumpToBoundary() {
        if (!dialog?.open || !modalJob || !Number.isInteger(modalJob.boundary)) return;
        showBoundary();
        const preview = dialog.querySelector('textarea'), at = modalJob.boundary;
        const measure = document.createElement('textarea'), computed = getComputedStyle(preview);
        for (const property of ['font', 'line-height', 'letter-spacing', 'word-spacing', 'padding', 'border', 'box-sizing', 'tab-size', 'overflow-wrap', 'word-break'])
            measure.style.setProperty(property, computed.getPropertyValue(property));
        Object.assign(measure.style, { position: 'fixed', left: '-10000px', width: preview.getBoundingClientRect().width + 'px', height: '0', minHeight: '0', maxHeight: 'none', visibility: 'hidden', overflow: 'hidden', overflowY: preview.scrollHeight > preview.clientHeight ? 'scroll' : 'hidden' });
        measure.setAttribute('aria-hidden', 'true'); measure.tabIndex = -1;
        measure.value = preview.value.slice(0, at) + '\u200b'; document.body.appendChild(measure);
        const top = measure.scrollHeight - (parseFloat(computed.lineHeight) || 24) - parseFloat(computed.paddingBottom || '0'); measure.remove();
        if (!preview.disabled) preview.focus({ preventScroll: true });
        preview.setSelectionRange(at, Math.min(preview.value.length, at + 80));
        preview.scrollTop = Math.max(0, top - preview.clientHeight / 3);
    }
    function closeDialog() {
        if (busy || preparing) return;
        dialog?.close();
        modalJob = null;
        schedule();
    }
    function showJob(job, recovering = false) {
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'cam-dialog';
            dialog.innerHTML = '<form method="dialog"><h2>답변 합치기</h2><p data-note></p><p data-status role="status" aria-live="polite"></p>' +
                '<div class="cam-connection" aria-label="두 답변의 연결 지점"><div class="cam-connection-head"><span>앞 답변 끝부분</span><button type="button" data-jump>연결 지점으로 이동</button></div><div data-before></div><div data-boundary-label></div><div data-after></div></div>' +
                '<label for="cam-preview">합쳐서 저장할 내용</label><textarea id="cam-preview" spellcheck="false"></textarea>' +
                '<div class="cam-actions"><button type="button" data-abandon hidden title="마무리 작업만 중단해요. 이미 저장된 크랙 본문은 되돌리지 않아요.">합치기 중단</button><span></span><button type="button" data-close>취소</button><button type="button" data-save>원문 합치기</button></div></form>';
            document.body.appendChild(dialog);
            dialog.querySelector('[data-close]').addEventListener('click', closeDialog);
            dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
            dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());
            // Keep other extensions' chat shortcuts out of this dialog.
            for (const type of ['keydown', 'keyup', 'keypress']) dialog.addEventListener(type, event => event.stopPropagation());
            dialog.querySelector('[data-save]').addEventListener('click', saveJob);
            dialog.querySelector('[data-jump]').addEventListener('click', jumpToBoundary);
            dialog.querySelector('textarea').addEventListener('input', event => {
                if (!modalJob) return;
                modalJob.boundary = moveBoundary(previewValue, event.target.value, modalJob.boundary);
                previewValue = event.target.value;
                showBoundary();
            });
            dialog.querySelector('[data-abandon]').addEventListener('click', async () => {
                if (busy || preparing || !modalJob) return;
                busy = true;
                try {
                    await withRoomLock(modalJob, () => abandonPending(modalJob));
                    dialog.querySelector('[data-save]').disabled = true;
                    dialog.querySelector('[data-abandon]').hidden = true;
                    dialog.querySelector('[data-close]').textContent = '닫기';
                    status('마무리 작업을 중단했어요. 이미 저장된 크랙 본문은 되돌리지 않았어요.');
                } catch (error) { status(error.message); }
                finally { busy = false; schedule(); }
            });
        }
        modalJob = job;
        dialog.querySelector('[data-note]').textContent = job.originals.length === 3 && !job.originals[1].commandOnly ?
            '두 AI 답변만 합치고 사이의 사용자 메시지(명령·대사·첨부)는 그대로 남겨요. 합친 답변은 그 사용자 메시지보다 앞에 놓여요.' : job.originals.length === 3 ?
            '앞 답변에 합쳐 저장한 뒤, 중복된 뒷 답변과 사이의 이어쓰기 명령을 지워요. 다른 대사는 유지돼요.' :
            '앞 답변에 합쳐 저장한 뒤, 중복된 뒷 답변만 지워요. 다른 대사는 유지돼요.';
        const preview = dialog.querySelector('textarea');
        preview.value = job.desired;
        previewValue = job.desired;
        job.boundary = boundaryFor(job);
        preview.disabled = recovering;
        showBoundary();
        dialog.querySelector('[data-save]').disabled = false;
        dialog.querySelector('[data-save]').textContent = recovering ? '남은 합치기 마무리' : '원문 합치기';
        dialog.querySelector('[data-close]').textContent = '취소';
        dialog.querySelector('[data-abandon]').hidden = !recovering;
        status(recovering ? '진행 중이던 기록이에요. 현재 서버 내용을 확인하고 남은 단계만 진행해요.' : '겹치는 상태줄이나 문장 연결은 여기서 고칠 수 있어요.');
        if (!dialog.open) dialog.showModal();
        requestAnimationFrame(() => { showBoundary(); jumpToBoundary(); });
    }
    async function openPair(pair) {
        if (busy || preparing || dialog?.open) return;
        const job = { version: 1, operationId: crypto.randomUUID(), chat: roomId(), path: location.pathname, at: new Date().toISOString(), originals: pair, desired: joinText(pair[0].content, pair.at(-1).content), complete: false };
        showJob(job);
        preparing = true;
        dialog.querySelector('[data-save]').disabled = true;
        status('서버의 원문을 확인하고 있어요…');
        try {
            const previous = pendingJob(job.chat);
            if (previous) { showJob(previous, true); return; }
            guard(job);
            const currentPairs = findPairs(rowsFor(guard(job)));
            if (!currentPairs.some(items => items.length === pair.length && items.every((item, i) => item.id === pair[i].id && item.content === pair[i].content)))
                throw new Error('두 답변의 위치나 내용이 바뀌었어요. 창을 닫고 +를 다시 눌러 주세요.');
            for (const original of pair) {
                const current = await readServer(job.chat, original.id);
                guard(job);
                if (!current || current.content !== original.content || current.role !== original.role) throw new Error('서버 원문이 화면과 달라요. 새로고침한 뒤 다시 눌러 주세요.');
            }
            dialog.querySelector('[data-save]').disabled = false;
            status('겹치는 상태줄이나 문장 연결은 여기서 고칠 수 있어요. 원문 합치기를 누르면 크랙에 저장해요.');
        } catch (error) { status(error.message); }
        finally { preparing = false; }
    }
    async function saveJob() {
        if (busy || preparing || !modalJob || modalJob.complete) return;
        const job = modalJob;
        const preview = dialog.querySelector('textarea');
        if (!preview.disabled) job.desired = preview.value;
        if (!job.desired.trim()) { status('합칠 내용을 비울 수 없어요.'); return; }
        busy = true;
        preview.disabled = true;
        dialog.querySelector('[data-save]').disabled = true;
        status('서버 저장 확인 → 중복 메시지 정리 중…');
        schedule();
        try {
            await withRoomLock(job, () => mergeVerified(job, createAdapter(job)));
            status('크랙에 합친 내용을 저장하고, 중복 메시지 삭제까지 확인했어요.');
            dialog.querySelector('[data-close]').textContent = '닫기';
            dialog.querySelector('[data-abandon]').hidden = true;
        } catch (error) {
            status(error.message);
            dialog.querySelector('[data-save]').textContent = '다시 확인하고 마무리';
            dialog.querySelector('[data-save]').disabled = false;
            try { dialog.querySelector('[data-abandon]').hidden = pendingJob(job.chat)?.operationId !== job.operationId; } catch (_) {}
        } finally { busy = false; if (job.complete) closeDialog(); else schedule(); }
    }
    function render() {
        timer = 0;
        const context = roomId() ? chatContext() : null;
        const pairs = context ? findPairs(rowsFor(context)) : [];
        const valid = new Set();
        let pending = null;
        try { pending = roomId() ? pendingJob(roomId()) : null; } catch (_) { /* A malformed record must not trigger server changes. */ }
        const disabled = busy || preparing || !context || context.state.status !== 'IDLE' || !!context.list.querySelector('.tiptap.ProseMirror:not(.__chat_input_textarea)');
        for (const pair of pairs) {
            const key = pair.map(m => m.id).join(':');
            valid.add(key);
            let bar = Array.from(document.querySelectorAll('[data-cam-pair]')).find(el => el.dataset.camPair === key);
            const group = getGroup(pair.at(-1).groupId);
            if (!group) continue;
            if (!bar) {
                bar = document.createElement('div'); bar.className = 'cam-between'; bar.dataset.camPair = key;
                const button = document.createElement('button'); button.type = 'button'; button.textContent = '+';
                button.title = '앞 답변과 원문 합치기'; button.setAttribute('aria-label', button.title);
                bar.appendChild(button); group.prepend(bar);
            }
            const button = bar.querySelector('button');
            button.onclick = event => { event.preventDefault(); event.stopPropagation(); void openPair(pair); };
            button.disabled = disabled || !!pending;
        }
        for (const bar of document.querySelectorAll('[data-cam-pair]')) if (!valid.has(bar.dataset.camPair)) bar.remove();
        let recovery = document.getElementById('cam-recovery');
        if (pending) {
            if (!recovery) {
                recovery = document.createElement('button'); recovery.id = 'cam-recovery'; recovery.type = 'button';
                recovery.textContent = '합치기 마무리';
                recovery.addEventListener('click', () => {
                    if (busy || preparing || dialog?.open) return;
                    try { const job = pendingJob(roomId()); if (job) showJob(job, true); } catch (error) { status(error.message); }
                });
                document.body.appendChild(recovery);
            }
            recovery.disabled = disabled;
        } else recovery?.remove();
        if (dialog?.open && modalJob && (roomId() !== modalJob.chat || location.pathname !== modalJob.path) && !busy && !preparing) closeDialog();
    }
    function schedule() { if (!timer) timer = setTimeout(render, 200); }
    function start() {
        if (document.getElementById('cam-style')) return;
        const style = document.createElement('style'); style.id = 'cam-style';
        style.textContent = `
.cam-between{display:flex;justify-content:center;margin:0 0 16px;clear:both}
.cam-between button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid var(--border_secondary,#666);border-radius:50%;background:var(--bg_screen,#202020);color:var(--text_secondary,#ddd);font:400 24px/1 system-ui;cursor:pointer}
.cam-between button:hover{border-color:#e7a4c3;color:#e7a4c3}
.cam-between button:focus-visible,#cam-dialog button:focus-visible,#cam-recovery:focus-visible{outline:2px solid #e7a4c3;outline-offset:3px}
.cam-between button:disabled,#cam-dialog button:disabled,#cam-recovery:disabled{opacity:.4;cursor:default}
#cam-dialog{box-sizing:border-box;width:min(760px,calc(100vw - 28px));max-height:calc(100dvh - 32px);padding:22px;border:1px solid var(--border_secondary,#555);border-radius:16px;background:var(--bg_screen,#202020);color:var(--text_primary,#eee);box-shadow:0 16px 60px #0006;font:14px/1.6 system-ui}
#cam-dialog::backdrop{background:#0009}
#cam-dialog form{margin:0;display:flex;flex-direction:column;gap:12px}
#cam-dialog form{max-height:calc(100dvh - 78px)}
#cam-dialog .cam-connection{flex-shrink:0;padding:10px 12px;border:1px solid var(--border_secondary,#666);border-radius:8px;font-size:12px;line-height:1.45}
#cam-dialog .cam-connection-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text_secondary,#ccc)}
#cam-dialog [data-jump]{padding:4px 8px;font-size:12px;white-space:nowrap}
#cam-dialog [data-before],#cam-dialog [data-after]{max-height:2.9em;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
#cam-dialog [data-after]{max-height:4.35em}
#cam-dialog [data-before]{color:var(--text_secondary,#bbb)}
#cam-dialog [data-boundary-label]{margin:6px 0;padding-top:5px;border-top:1px dashed #d895b6;color:#e7a4c3;font-weight:650}
#cam-dialog h2{font-size:18px;margin:0}
#cam-dialog p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
#cam-dialog [data-status]{font-size:13px;color:var(--text_secondary,#ccc)}
#cam-dialog textarea{box-sizing:border-box;width:100%;min-height:140px;height:43dvh;flex:1 1 auto;resize:vertical;padding:12px;border:1px solid var(--border_secondary,#666);border-radius:8px;background:var(--bg_base,#171717);color:inherit;font:14px/1.7 system-ui}
#cam-dialog textarea:disabled{opacity:1;-webkit-text-fill-color:currentColor}
#cam-dialog .cam-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}
#cam-dialog .cam-actions span{flex:1}
#cam-dialog button,#cam-recovery{border:1px solid var(--border_secondary,#666);border-radius:9px;padding:8px 12px;background:var(--bg_base,#262626);color:var(--text_primary,#eee);font:inherit;cursor:pointer}
#cam-dialog [data-save]{background:#d895b6;border-color:#d895b6;color:#25151e;font-weight:650}
#cam-recovery{position:fixed;bottom:24px;left:84px;z-index:2147483000;font:13px system-ui}
@media(max-width:480px){#cam-dialog{padding:16px}#cam-dialog .cam-actions{gap:7px}#cam-dialog .cam-actions span{display:none}#cam-recovery{left:12px;bottom:16px}}
`;
        document.head.appendChild(style);
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
        setInterval(schedule, 1500);
        schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
