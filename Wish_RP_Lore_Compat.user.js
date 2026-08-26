// ==UserScript==
// @name         🪽위시 RP Manager × 에리 로어 인젝터 호환 확프
// @namespace    local.wish.rp.lore.compat
// @version      0.1.0
// @description  에리의 크랙 로어 인젝터 Refiner가 🪽위시 RP Manager 숨김 블록을 화면에 빈 주석으로 렌더링하는 현상만 정리합니다.
// @author       User
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
  if(_w.__LoreRefinerRenderCleanupPatch)return;
  _w.__LoreRefinerRenderCleanupPatch={version:"rpcmfix2"};

  // 핵심 원인:
  // Lore Refiner의 refreshMessageInDOM()은 교정 결과를 자체 Markdown HTML로 다시 그릴 때
  // '<'와 '>'를 escape합니다. 따라서 RP 매니저의 숨김 HTML 주석이 실제 주석이 아니라
  // '<!---->' 같은 보이는 글자로 바뀔 수 있습니다.
  // 이 패치는 서버/React 저장값을 건드리지 않고, Refiner가 DOM에 그리는 문자열에서만
  // RP 매니저 숨김 블록을 제거합니다.

  const RP_BLOCK_RE=/\\?<!--RP_CONTEXT_MANAGER_START[\s\S]*?RP_CONTEXT_MANAGER_END-->/gi;
  const RP_LEGACY_RE=/\\?<rp_context_manager\b[\s\S]*?<\/rp_context_manager>/gi;
  const EMPTY_COMMENT_RE=/^<!-{2,}\s*>$/;
  const ZERO_WIDTH_RE=/[\u200B-\u200D\u2060\uFEFF]/g;
  let observer=null;

  function normalizeResidual(value){
    return String(value||'').replace(ZERO_WIDTH_RE,'').trim();
  }

  function stripRpcmForRender(value){
    let s=String(value==null?'':value);
    s=s.replace(RP_BLOCK_RE,'').replace(RP_LEGACY_RE,'');
    // 이미 어떤 렌더 단계에서 내용만 지워져 빈 주석 모양이 된 경우도 렌더용 문자열에서만 제거.
    s=s.split('\n').filter(line=>!EMPTY_COMMENT_RE.test(normalizeResidual(line))).join('\n');
    return s.replace(/\n{3,}/g,'\n\n').replace(/\s+$/,'');
  }

  function cleanExactResiduals(root){
    if(!root||!document.contains(root))return 0;
    let changed=0;
    try{
      const scope=root.matches&&root.matches('.wrtn-markdown')?root:null;
      const markdowns=scope?[scope]:Array.from(root.querySelectorAll?root.querySelectorAll('.wrtn-markdown'):[]);
      for(const md of markdowns){
        const walker=document.createTreeWalker(md,NodeFilter.SHOW_TEXT);
        const textNodes=[];let n;
        while((n=walker.nextNode())){
          if(EMPTY_COMMENT_RE.test(normalizeResidual(n.nodeValue)))textNodes.push(n);
        }
        for(const t of textNodes){t.nodeValue='';changed++}
        for(const el of Array.from(md.querySelectorAll('span,p,div,br'))){
          if(el.tagName==='BR')continue;
          if(el.children.length)continue;
          if(EMPTY_COMMENT_RE.test(normalizeResidual(el.textContent))){el.remove();changed++}
        }
      }
    }catch(_){}
    return changed;
  }

  function findContainer(messageId){
    if(!messageId)return null;
    const id=String(messageId).replace(/"/g,'\\"');
    let c=document.querySelector(`[data-lore-refiner-message-id="${id}"]`);
    try{
      if(!c&&_w.__LoreRefiner&&typeof _w.__LoreRefiner.findMessageContainerById==='function')
        c=_w.__LoreRefiner.findMessageContainerById(messageId);
    }catch(_){}
    return c;
  }

  function cleanByMessageId(messageId){
    const c=findContainer(messageId);
    return c?cleanExactResiduals(c):0;
  }

  function wrapRefiner(){
    const R=_w.__LoreRefiner;
    if(!R||R.__rpcmRenderCleanupWrapped)return false;
    if(typeof R.refreshMessageInDOM!=='function')return false;
    R.__rpcmRenderCleanupWrapped=true;

    const originalRefresh=R.refreshMessageInDOM;
    R.refreshMessageInDOM=function(originalText,newText,messageId){
      // 중요: 원본 인수 자체/서버 저장값은 바꾸지 않고, 이 DOM refresh 호출에 넘기는 복사본만 정리합니다.
      const renderOld=stripRpcmForRender(originalText);
      const renderNew=stripRpcmForRender(newText);
      const result=originalRefresh.call(this,renderOld,renderNew,messageId);
      queueMicrotask(()=>{try{cleanByMessageId(messageId)}catch(_){}});
      setTimeout(()=>{try{cleanByMessageId(messageId)}catch(_){}},0);
      setTimeout(()=>{try{cleanByMessageId(messageId)}catch(_){}},120);
      setTimeout(()=>{try{cleanByMessageId(messageId)}catch(_){}},500);
      return result;
    };

    if(typeof R.rememberAssistantMessage==='function'){
      const originalRemember=R.rememberAssistantMessage;
      R.rememberAssistantMessage=function(messageId,text){
        const result=originalRemember.call(this,messageId,stripRpcmForRender(text));
        queueMicrotask(()=>{try{cleanByMessageId(messageId)}catch(_){}});
        return result;
      };
    }
    return true;
  }

  function startScopedObserver(){
    if(observer||!document.documentElement)return;
    observer=new MutationObserver(mutations=>{
      const targets=new Set;
      for(const m of mutations){
        const el=m.target&&m.target.nodeType===1?m.target:m.target&&m.target.parentElement;
        if(el){
          const marked=el.closest&&el.closest('[data-lore-refiner-message-id]');
          if(marked)targets.add(marked);
        }
        for(const added of Array.from(m.addedNodes||[])){
          const ae=added&&added.nodeType===1?added:added&&added.parentElement;
          if(!ae)continue;
          const marked=ae.closest&&ae.closest('[data-lore-refiner-message-id]');
          if(marked)targets.add(marked);
          if(ae.querySelectorAll)for(const x of Array.from(ae.querySelectorAll('[data-lore-refiner-message-id]')))targets.add(x);
        }
      }
      for(const t of targets)cleanExactResiduals(t);
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  }

  function boot(){
    startScopedObserver();
    const deadline=Date.now()+45000;
    const timer=setInterval(()=>{
      if(wrapRefiner()||Date.now()>deadline)clearInterval(timer);
    },100);
    wrapRefiner();
  }

  if(document.documentElement)boot();
  else document.addEventListener('DOMContentLoaded',boot,{once:true});
}();
