// ==UserScript==
// @name         🪽위시 RP Manager × 에리 로어 인젝터 호환 확프
// @namespace    local.wish.rp.lore.compat
// @version      0.1.2
// @description  에리의 크랙 로어 인젝터 Refiner가 🪽위시 RP Manager 숨김 블록을 화면에 빈 주석으로 렌더링하는 현상만 정리합니다.
// @author       User
// @license      All Rights Reserved
// @homepageURL  https://github.com/llljjj0601-cpu/rp-manager
// @supportURL   https://github.com/llljjj0601-cpu/rp-manager
// @updateURL    https://raw.githubusercontent.com/llljjj0601-cpu/rp-manager/main/Wish_RP_Lore_Compat.user.js
// @downloadURL  https://raw.githubusercontent.com/llljjj0601-cpu/rp-manager/main/Wish_RP_Lore_Compat.user.js
// @match        https://crack.wrtn.ai/stories/*/episodes/*
// @match        https://crack.wrtn.ai/characters/*/chats/*
// @match        https://crack.wrtn.ai/u/*/c/*
// @grant        unsafeWindow
// @sandbox      raw
// @run-at       document-start
// ==/UserScript==

// ============================================================
// 🪽위시 RP Manager × 에리 로어 인젝터 호환 확프
//
// 에리 로어 인젝터 원본 코드를 포함하지 않는 독립 호환 스크립트입니다.
// 에리 로어 인젝터의 권리는 원제작자에게 있습니다.
// 본 호환 확프의 무단 재배포 / 수정본 재배포는 원하지 않습니다.
// 최신 원본은 위 GitHub 배포처에서 받아주세요.
// ============================================================

!function(){
  "use strict";

  const _w="undefined"!=typeof unsafeWindow?unsafeWindow:window;
  if(_w.__WishRpcmLoreCompat?.loaded)return;
  _w.__WishRpcmLoreCompat={loaded:true,version:"0.1.2",loadedAt:Date.now()};

  // 서버/React 저장값은 건드리지 않고 Refiner의 DOM refresh 인수와 화면 잔여물만 정리합니다.
  const RP_BLOCK_RE=/\\?<!--RP_CONTEXT_MANAGER_START[\s\S]*?RP_CONTEXT_MANAGER_END-->/gi;
  const RP_LEGACY_RE=/\\?<rp_context_manager\b[\s\S]*?<\/rp_context_manager>/gi;
  const RP_ENCODED_RE=/\\?&lt;!--RP_CONTEXT_MANAGER_START[\s\S]*?RP_CONTEXT_MANAGER_END--&gt;/gi;

  // v0.1.2: Refiner/Markdown 렌더러가 숨김 블록을 지운 뒤 남기는 빈 HTML 주석을
  // raw / HTML entity / 백슬래시 escape 형태까지 모두 화면에서만 제거합니다.
  const ZERO_WIDTH_RE=/[\u200B-\u200D\u2060\uFEFF]/g;
  const EMPTY_COMMENT_RAW_RE=/\\?<!--[\s\u200B-\u200D\u2060\uFEFF]*-->/gi;
  const EMPTY_COMMENT_ENCODED_RE=/\\?&lt;!--(?:\s|&nbsp;|&#160;|\u00a0|[\u200B-\u200D\u2060\uFEFF])*--&gt;/gi;
  const EMPTY_COMMENT_EXACT_RE=/^(?:\\?<!--[\s\u200B-\u200D\u2060\uFEFF]*-->|\\?&lt;!--(?:\s|&nbsp;|&#160;|\u00a0|[\u200B-\u200D\u2060\uFEFF])*--&gt;)$/i;

  const pendingRoots=new Set;
  let observer=null;
  let cleanFrame=0;

  function normalizeResidual(value){
    return String(value||"").replace(ZERO_WIDTH_RE,"").trim();
  }

  function stripEmptyCommentResiduals(value){
    return String(value==null?"":value)
      .replace(EMPTY_COMMENT_RAW_RE,"")
      .replace(EMPTY_COMMENT_ENCODED_RE,"");
  }

  function stripRpcmForRender(value){
    let s=String(value==null?"":value);
    s=s.replace(RP_BLOCK_RE,"").replace(RP_LEGACY_RE,"").replace(RP_ENCODED_RE,"");
    s=stripEmptyCommentResiduals(s);
    return s.replace(/\n{3,}/g,"\n\n").replace(/\s+$/,"");
  }

  function isProtectedLiteral(node){
    return !!node?.parentElement?.closest("pre,code,kbd,samp,#rpcm-overlay,#rpcm-raw-viewer,#rpcm-detached-backdrop");
  }

  function markdownScopesForRoot(root){
    if(!root||!root.isConnected)return[];
    const scopes=[];
    try{
      if(root.matches?.(".wrtn-markdown"))scopes.push(root);
      for(const md of root.querySelectorAll?.(".wrtn-markdown")||[])scopes.push(md);
      // Refiner 마커가 붙은 메시지인데 Markdown 클래스가 바뀐 경우에도 그 메시지 안에서만 정리합니다.
      if(!scopes.length&&root.matches?.("[data-lore-refiner-message-id]"))scopes.push(root);
    }catch(_){}
    return [...new Set(scopes)];
  }

  function cleanScope(scope){
    if(!scope||!scope.isConnected)return 0;
    let changed=0;
    try{
      // 실제 DOM Comment 노드(<!-- -->)로 남는 경우 제거합니다.
      const commentWalker=document.createTreeWalker(scope,NodeFilter.SHOW_COMMENT);
      const comments=[];
      let comment;
      while((comment=commentWalker.nextNode())){
        if(normalizeResidual(comment.nodeValue)==="")comments.push(comment);
      }
      for(const node of comments){node.remove();changed++}

      // 문자 그대로 <!----> / &lt;!----&gt;가 남는 경우, 노드 전체가 아니어도 해당 부분만 제거합니다.
      const textWalker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
      const textNodes=[];
      let node;
      while((node=textWalker.nextNode())){
        if(isProtectedLiteral(node))continue;
        const before=String(node.nodeValue||"");
        const after=stripEmptyCommentResiduals(before);
        if(after!==before)textNodes.push({node,after});
      }
      for(const item of textNodes){item.node.nodeValue=item.after;changed++}

      // 빈 주석만 담고 있던 wrapper가 남아 줄 하나를 차지하는 경우 같이 정리합니다.
      for(const el of Array.from(scope.querySelectorAll?.("span,p,div")||[])){
        if(el===scope||el.children.length||el.closest("pre,code,kbd,samp,#rpcm-overlay,#rpcm-raw-viewer,#rpcm-detached-backdrop"))continue;
        const text=normalizeResidual(el.textContent);
        if(!text||EMPTY_COMMENT_EXACT_RE.test(text)){
          // 일반적인 빈 layout div까지 지우지 않도록, 빈 주석 흔적이 있었던 요소만 대상으로 좁힙니다.
          const html=String(el.innerHTML||"");
          if(/<!-{2,}|&lt;!-{2,}/i.test(html)){el.remove();changed++}
        }
      }
    }catch(_){}
    return changed;
  }

  function cleanExactResiduals(root){
    let changed=0;
    for(const scope of markdownScopesForRoot(root))changed+=cleanScope(scope);
    return changed;
  }

  function flushCleanQueue(){
    cleanFrame=0;
    const roots=[...pendingRoots];
    pendingRoots.clear();
    for(const root of roots)cleanExactResiduals(root);
  }

  function queueRoot(root){
    if(!root?.isConnected)return;
    pendingRoots.add(root);
    if(cleanFrame)return;
    cleanFrame=(typeof requestAnimationFrame==="function"?requestAnimationFrame:setTimeout)(flushCleanQueue);
  }

  function findContainer(messageId){
    if(!messageId)return null;
    const id=String(messageId);
    let container=null;
    try{container=document.querySelector(`[data-lore-refiner-message-id="${CSS.escape(id)}"]`)}catch(_){}
    try{
      if(!container&&_w.__LoreRefiner&&typeof _w.__LoreRefiner.findMessageContainerById==="function"){
        container=_w.__LoreRefiner.findMessageContainerById(messageId);
      }
    }catch(_){}
    return container;
  }

  function queueMessageClean(messageId){
    const run=()=>{const container=findContainer(messageId);if(container)queueRoot(container)};
    queueMicrotask(run);
    setTimeout(run,0);
    setTimeout(run,120);
    setTimeout(run,500);
    setTimeout(run,1200);
  }

  function wrapRefiner(){
    const R=_w.__LoreRefiner;
    if(!R)return false;
    let found=false;

    if(typeof R.refreshMessageInDOM==="function"){
      found=true;
      const current=R.refreshMessageInDOM;
      if(!current.__wishRpcmRenderCleanupWrapper){
        function wrappedRefresh(originalText,newText,messageId){
          const result=current.call(this,stripRpcmForRender(originalText),stripRpcmForRender(newText),messageId);
          queueMessageClean(messageId);
          if(result&&typeof result.then==="function")result.then(()=>queueMessageClean(messageId),()=>queueMessageClean(messageId));
          return result;
        }
        Object.defineProperty(wrappedRefresh,"__wishRpcmRenderCleanupWrapper",{value:true});
        Object.defineProperty(wrappedRefresh,"__wishRpcmOriginal",{value:current});
        R.refreshMessageInDOM=wrappedRefresh;
      }
    }

    // 첨부된 Refiner 원본에서 이 함수는 캐시/서버 저장이 아니라 DOM 컨테이너에
    // data-lore-refiner-message-id를 붙이는 탐색 함수임을 확인했습니다.
    if(typeof R.rememberAssistantMessage==="function"){
      found=true;
      const currentRemember=R.rememberAssistantMessage;
      if(!currentRemember.__wishRpcmRememberWrapper){
        function wrappedRemember(messageId,text){
          const container=currentRemember.call(this,messageId,stripRpcmForRender(text));
          if(container)queueRoot(container);
          queueMessageClean(messageId);
          return container;
        }
        Object.defineProperty(wrappedRemember,"__wishRpcmRememberWrapper",{value:true});
        Object.defineProperty(wrappedRemember,"__wishRpcmOriginal",{value:currentRemember});
        R.rememberAssistantMessage=wrappedRemember;
      }
    }
    return found;
  }

  function rootFromMutationNode(node){
    const el=node?.nodeType===1?node:node?.parentElement;
    if(!el)return null;
    return el.closest?.("[data-lore-refiner-message-id],.wrtn-markdown")||null;
  }

  function startScopedObserver(){
    if(observer||!document.documentElement)return;
    observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        const targetRoot=rootFromMutationNode(mutation.target);
        if(targetRoot)queueRoot(targetRoot);

        for(const added of mutation.addedNodes||[]){
          const own=rootFromMutationNode(added);
          if(own)queueRoot(own);
          const el=added?.nodeType===1?added:added?.parentElement;
          if(!el)continue;
          for(const child of el.querySelectorAll?.("[data-lore-refiner-message-id],.wrtn-markdown")||[])queueRoot(child);
        }
      }
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  }

  function sweepExistingMarkdown(){
    try{
      for(const md of document.querySelectorAll?.(".wrtn-markdown")||[])queueRoot(md);
      for(const marked of document.querySelectorAll?.("[data-lore-refiner-message-id]")||[])queueRoot(marked);
    }catch(_){}
  }

  function startDomPart(){
    startScopedObserver();
    wrapRefiner();
    sweepExistingMarkdown();
    setTimeout(sweepExistingMarkdown,300);
    setTimeout(sweepExistingMarkdown,1200);
  }

  // Refiner가 늦게 로드되거나 SPA 이동 중 함수를 교체해도 새 함수를 다시 감쌉니다.
  wrapRefiner();
  setInterval(()=>{wrapRefiner();sweepExistingMarkdown()},2000);
  if(document.documentElement)startDomPart();
  else document.addEventListener("DOMContentLoaded",startDomPart,{once:true});
}();
