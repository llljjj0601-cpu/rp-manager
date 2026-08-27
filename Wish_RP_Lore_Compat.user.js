// ==UserScript==
// @name         🪽위시 RP Manager × 에리 로어 인젝터 호환 확프
// @namespace    local.wish.rp.lore.compat
// @version      0.1.1
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
  _w.__WishRpcmLoreCompat={loaded:true,version:"0.1.1",loadedAt:Date.now()};

  // 서버/React 저장값은 건드리지 않고 Refiner의 DOM refresh 인수와 화면 잔여물만 정리합니다.
  const RP_BLOCK_RE=/\\?<!--RP_CONTEXT_MANAGER_START[\s\S]*?RP_CONTEXT_MANAGER_END-->/gi;
  const RP_LEGACY_RE=/\\?<rp_context_manager\b[\s\S]*?<\/rp_context_manager>/gi;
  const RP_ENCODED_RE=/\\?&lt;!--RP_CONTEXT_MANAGER_START[\s\S]*?RP_CONTEXT_MANAGER_END--&gt;/gi;
  const EMPTY_COMMENT_RE=/^\\?<!-{2,}\s*>$/;
  const ZERO_WIDTH_RE=/[\u200B-\u200D\u2060\uFEFF]/g;
  const pendingRoots=new Set;
  let observer=null;
  let cleanFrame=0;

  function normalizeResidual(value){
    return String(value||"").replace(ZERO_WIDTH_RE,"").trim();
  }

  function stripRpcmForRender(value){
    let s=String(value==null?"":value);
    s=s.replace(RP_BLOCK_RE,"").replace(RP_LEGACY_RE,"").replace(RP_ENCODED_RE,"");
    s=s.split("\n").filter(line=>!EMPTY_COMMENT_RE.test(normalizeResidual(line))).join("\n");
    return s.replace(/\n{3,}/g,"\n\n").replace(/\s+$/,"");
  }

  function isProtectedLiteral(node){
    return !!node?.parentElement?.closest("pre,code,kbd,samp,#rpcm-overlay,#rpcm-raw-viewer");
  }

  function cleanExactResiduals(root){
    if(!root||!root.isConnected)return 0;
    let changed=0;
    try{
      const markdowns=root.matches?.(".wrtn-markdown")
        ?[root]
        :Array.from(root.querySelectorAll?.(".wrtn-markdown")||[]);
      for(const md of markdowns){
        const walker=document.createTreeWalker(md,NodeFilter.SHOW_TEXT);
        const textNodes=[];
        let node;
        while((node=walker.nextNode())){
          if(isProtectedLiteral(node))continue;
          if(EMPTY_COMMENT_RE.test(normalizeResidual(node.nodeValue)))textNodes.push(node);
        }
        for(const textNode of textNodes){textNode.nodeValue="";changed++}
        for(const el of Array.from(md.querySelectorAll("span,p"))){
          if(el.children.length||el.closest("pre,code,kbd,samp"))continue;
          if(EMPTY_COMMENT_RE.test(normalizeResidual(el.textContent))){el.remove();changed++}
        }
      }
    }catch(_){}
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
          return container;
        }
        Object.defineProperty(wrappedRemember,"__wishRpcmRememberWrapper",{value:true});
        Object.defineProperty(wrappedRemember,"__wishRpcmOriginal",{value:currentRemember});
        R.rememberAssistantMessage=wrappedRemember;
      }
    }
    return found;
  }

  function startScopedObserver(){
    if(observer||!document.documentElement)return;
    observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        const target=mutation.target?.nodeType===1?mutation.target:mutation.target?.parentElement;
        const marked=target?.closest?.("[data-lore-refiner-message-id]");
        if(marked)queueRoot(marked);
        for(const added of mutation.addedNodes||[]){
          const el=added?.nodeType===1?added:added?.parentElement;
          if(!el)continue;
          const own=el.closest?.("[data-lore-refiner-message-id]");
          if(own)queueRoot(own);
          for(const child of el.querySelectorAll?.("[data-lore-refiner-message-id]")||[])queueRoot(child);
        }
      }
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  }

  function startDomPart(){
    startScopedObserver();
    wrapRefiner();
  }

  // Refiner가 늦게 로드되거나 SPA 이동 중 함수를 교체해도 새 함수를 다시 감쌉니다.
  wrapRefiner();
  setInterval(wrapRefiner,2000);
  if(document.documentElement)startDomPart();
  else document.addEventListener("DOMContentLoaded",startDomPart,{once:true});
}();
