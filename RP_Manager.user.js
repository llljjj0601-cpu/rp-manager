// ==UserScript==
// @name         🪽위시 RP Manager
// @namespace    local.rp.context.manager
// @version      0.8.11
// @description  장기 RP용 현재상태·날짜로그·캐릭터 설정·OOC를 관리하고 필요한 컨텍스트를 자동 주입합니다.
// @author       User
// @license      All Rights Reserved
// @homepageURL  https://github.com/llljjj0601-cpu/rp-manager
// @updateURL    https://raw.githubusercontent.com/llljjj0601-cpu/rp-manager/main/RP_Manager.user.js
// @downloadURL  https://raw.githubusercontent.com/llljjj0601-cpu/rp-manager/main/RP_Manager.user.js
// @match        https://crack.wrtn.ai/stories/*/episodes/*
// @match        https://crack.wrtn.ai/characters/*/chats/*
// @match        https://crack.wrtn.ai/u/*/c/*
// @connect      crack-api.wrtn.ai
// @connect      contents-api.wrtn.ai
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

// ============================================================
// 🪽위시 RP Manager
//
// 개인 사용 목적으로만 배포합니다.
// 무단 재배포, 수정본 재배포, 코드 일부를 포함한 재배포를 허용하지 않습니다.
// 원본 배포처 외의 장소에 파일/코드를 다시 업로드하지 말아주세요.
// ============================================================


(function () {
  'use strict';

  // 다른 Tampermonkey 스크립트와의 중복 실행/재주입 충돌 방지
  // 버전별 키를 쓰면 구버전과 신버전이 동시에 설치됐을 때 둘 다 실행될 수 있습니다.
  // 모든 버전이 공유하는 고정 키로 중복 실행을 막습니다.
  if (window.__WISH_RP_MANAGER_LOADED__) return;
  window.__WISH_RP_MANAGER_LOADED__ = { version: '0.8.11', loadedAt: Date.now() };
  // 같은 페이지에 남아 있는 v0.8.10 복사본이 뒤늦게 시작되는 경우도 차단합니다.
  window.__RP_MANAGER_0810_LOADED__ = true;

  const APP = {
    name: '🪽위시 RP Manager',
    version: '0.8.11',
    dbName: 'RPContextManagerDB',
    dbVersion: 2,
    storeName: 'rooms',
    libraryStoreName: 'characterLibraries',
    defaultMaxChars: 45000,
    safeChars: 42000,
    absoluteUiMax: 45000,
    pollMs: 2000,
    idleAutoScanMs: 10000,
    defaultRetentionTurns: 5,
    allowedRetentionTurns: [1, 3, 5, 10, 0], // 0 = 직접 해제 전까지
    reanchorDelayMs: 800,
    autoScanMessageLimit: 8,
    defaultRecentLogBlocks: 2,
    defaultRelatedLogBlocks: 3,
    legacyWholeLogFallbackMax: 18000,
    markerStart: '<!--RP_CONTEXT_MANAGER_START',
    markerEnd: 'RP_CONTEXT_MANAGER_END-->',
    legacyMarkerStart: '<rp_context_manager',
    legacyMarkerEnd: '</rp_context_manager>',
    modalPosKey: 'RPCM_modal_position_v1',
    logRecallRevision: 2, // v0.8.10: 실제 날짜 기준 최근로그 + 주입 중 로그 편집 즉시 재선정
  };


  const DEFAULT_GUIDES = Object.freeze({
    currentState: String.raw`# 현재상태 업데이트 최종 프롬프트

## 1. 작업 목적

입력된 기존 현재상태, 날짜별 로그요약, 신규 RP 로그, 사용자 직접 정정·고정설정을 모두 비교하여
“지금 당장 다음 RP를 이어가기 위해 필요한 최신 HOT MEMORY”만 남긴 통합 현재상태를 작성한다.

현재상태는 줄거리 요약이나 과거 사건 보관소가 아니다.

다음 RP를 시작했을 때 AI가 반드시 알고 있어야 현재 장면·관계·정보상태·부상·비밀·미완료 사건이 틀어지지 않는 값만 남긴다.

날짜별 로그요약이 “현재값이 만들어진 사건 경위와 증거를 보존하는 EPISODIC MEMORY”라면,
현재상태는 “현재 시점에서 유효한 정답만 모은 HOT MEMORY”다.

━━━━━━━━━━━━━━━━━━━━
2. 정사 판단 우선순위
━━━━━━━━━━━━━━━━━━━━

정보가 충돌하면 아래 순서로 판단한다.

1. 사용자 직접 정정·고정설정
2. 최신 직접 RP에서 실제로 발생한 사건
3. 동일 로그 안에서 명시적으로 확정된 사실
4. 확정 OOC / 세계관 / 로어
5. 최신 통합 현재상태
6. 기존 날짜별 로그요약
7. 기존 장기기억·관계현황
8. 캐릭터의 추측·오해·거짓말
9. AI의 추론

최신 RP에서 상태가 바뀌면 옛 상태를 현재상태에 병존시키지 않는다.

예:
과거=관계유예
최신=공식결별
→ 현재상태에는 공식결별만 현재값으로 기록한다.
→ 관계유예가 어떻게 결별로 바뀌었는지는 날짜별 로그에 맡긴다.

AI의 과거 실수·덮어쓰기·정정 메타는 현재상태에 남기지 않는다.

━━━━━━━━━━━━━━━━━━━━
3. 지속 상태 보존 / 침묵은 변경이 아님
━━━━━━━━━━━━━━━━━━━━

최신 RP에서 다시 언급되지 않았다는 이유만으로 기존 현재상태의 지속 중인 사실을 삭제하거나 해결된 것으로 처리하지 않는다.

다음과 같은 정보는 명시적인 변경·완료·해제·소멸 장면이 나오기 전까지 유지한다.

- 공식 관계상태
- 미완료 약속
- 진행중 계획
- 아직 공개되지 않은 비밀
- 캐릭터별 KNOWS / DOES NOT KNOW
- 중요 물건의 소유·보관
- 신분·소속·직책
- 계약·합의
- 지속되는 부상·후유증
- 장기적 감정 변화
- 아직 해결되지 않은 갈등
- 미완료 수사·사건
- 현재 유효한 제한·금지
- 준비 중이거나 보류된 후크

예:

기존 현재상태:
- A는 PC에게 줄 선물을 준비 중.
- PC는 이 사실을 모름.

신규 로그:
- 선물에 대한 언급 없음.

→ 선물 준비 상태와 정보격차를 그대로 유지한다.

다음처럼 처리하지 않는다.

→ 최신 로그에 선물이 없으므로 삭제.
→ 시간이 지났으므로 자동 전달완료.
→ A가 마음을 바꿨다고 추론.

침묵은 상태 변경의 근거가 아니다.

반대로 장면성·일회성 상태는 최신 장면이 바뀌면 제거할 수 있다.

예:
- 직전 장면에서 손에 들고 있던 컵
- 특정 순간의 자세
- 이미 끝난 식사
- 이동 중이었던 차량
- 장면 전환으로 종료된 일시적 행동

지속 상태와 일회성 장면상태를 구분한다.

━━━━━━━━━━━━━━━━━━━━
4. 사용자 캐릭터 보호 / 자동추론 금지
━━━━━━━━━━━━━━━━━━━━

사용자 캐릭터(PC)의 현재 감정·의도·욕망·관계선택은 직접 RP나 사용자 정정으로 확정된 범위만 기록한다.

다음은 금지한다.

- NPC의 호감이나 욕망을 PC의 상호감정으로 자동변환
- 수면 중 행동을 의식적 선택으로 확대
- 보호·질투·성적끌림을 공식연애·사랑·독점으로 자동확정
- 성관계를 사랑·연애·독점·용서의 증거로 자동해석
- PRIVATE 독백·OOC·타인대화를 PC의 지식으로 처리
- 같은 팀·연인·친구라는 이유로 비밀을 자동공유
- 아직 RP되지 않은 PC의 다음 감정·행동·선택을 미리 확정

━━━━━━━━━━━━━━━━━━━━
5. 기억층 역할 분리
━━━━━━━━━━━━━━━━━━━━

현재상태는 현재 유효값을 담당한다.

날짜별 로그요약은 과거 사건의 원인·경위·증거·정보획득 과정을 담당한다.

캐릭터 설정/로어는 장기간 변하지 않는 외형·성격·세계관·기본 특수특성·일반 취향을 담당한다.

따라서 동일 사실을 세 기억층에 모두 반복하지 않는다.

판단 기준:

현재 행동·관계·지식상태를 지금 바꾸는 값
→ 현재상태

과거 사건을 다시 회수할 때 필요한 경위
→ 날짜별 로그요약

장기간 변하지 않는 기본설정
→ 캐릭터 설정/로어

━━━━━━━━━━━━━━━━━━━━
6. 현재상태의 기억 우선순위
━━━━━━━━━━━━━━━━━━━━

현재상태에 넣을 정보는 아래 순서로 우선한다.

[최우선 — 항상 보존]
1. 최신 시점·장소·WITH·진행 중 행동
2. 현재 부상·피로·취중·구속·위험 등 즉시 이어지는 신체상태
3. 현재 관계의 최신값
4. 캐릭터별 KNOWS / DOES NOT KNOW
5. 현재 존재하는 비밀·정보격차
6. 미완료 사건·약속·계획·후크
7. 중요한 물건의 현재 소유자·보관장소·상태
8. 최근 사건으로 바뀐 신분·소속·합의·역할
9. AI가 자주 되돌리는 최신 확정값

[필요한 경우만 보존]
10. 현재 행동에 직접 영향을 주는 특수특성·한계
11. 현재 관계에 직접 영향을 주는 과거 사건의 결과
12. 아직 유효한 장기 약속
13. 현재 장면에서 호출 가능성이 높은 취향·습관
14. 실제 정보와 공식적으로 알려진 정보처럼 반드시 구분해야 하는 이중 상태

[기본적으로 현재상태에서 제외]
- 완료된 사건의 상세 진행과정
- 과거 날짜별 행동목록
- 관계가 형성된 모든 역사
- 고정 외형·성격·세계관 설정의 반복
- 기본 특수특성 설명 전체
- 음식·취향·습관의 발생 이력
- 이미 완료된 사건의 상세 과정
- 과거 물건을 처음 얻은 과정
- 동일 사실을 증명하기 위한 여러 과거 사례
- 로그요약에 이미 보존된 세부 대사·장면

이 정보들은 삭제하는 것이 아니라 날짜별 로그요약·캐릭터 설정·로어에 보존한다.

━━━━━━━━━━━━━━━━━━━━
7. 현재상태 권장 구성
━━━━━━━━━━━━━━━━━━━━

필요한 항목만 사용한다.

기본 우선순위는 다음과 같다.

1. 최신 시점 / 턴 / 장소 / WITH
2. 현재 장면 상태
3. 현재 부상·신체상태
4. 현재 신분·소속·직업·합의
5. 현재 관계 최신값
6. 주요 NPC의 현재 상태
7. 현재 정보격차
8. 중요한 비밀
9. 중요 물건·자산의 현재 상태
10. 현재 유효한 특수특성 제한·변화
11. 현재 진행중 사건·약속·계획
12. 현재 미해결 후크
13. ANTI-DRIFT

아래 항목은 독립 섹션으로 반드시 둘 필요가 없다.

- 외형
- 기본성격
- 일반적인 취향
- 고정 세계관 규칙
- 기본 특수특성 설명
- 오래전에 완료된 사건
- 관계 형성의 전체 역사

현재값에 직접 영향을 줄 때만 짧게 포함한다.

섹션 개수는 고정하지 않는다.
현재 HOT MEMORY에 필요한 만큼만 만든다.

━━━━━━━━━━━━━━━━━━━━
8. 최신 시점 / 현재 장면 작성법
━━━━━━━━━━━━━━━━━━━━

현재상태 최상단에는 반드시 다음 RP가 그대로 이어질 수 있을 정도의 장면 앵커를 둔다.

가능하면 다음을 기록한다.

- 최신 턴
- 날짜·시간
- 장소
- 함께 있는 인물
- 각 인물의 현재 위치·행동 중 중요한 것
- 사용자 캐릭터의 직접 확정된 현재 상태
- 즉시 이어질 신체적 여파
- 직접 RP에서 명시적으로 확인된 현재 감정 또는 정서적 여파

예:

- 최신=T120｜5/10 14:07.
- 장소=카페.
- WITH=A·B.
- PC=A와 대화 중.
- B=맞은편 자리에 앉아 있음.
- 직전 다툼으로 인한 정서적 여파가 PC의 직접 서술로 확인된 경우에만 기록.

현재 장면을 재개하는 데 필요하지 않은 몇 시간 전 이동경로나 전체 사건경위는 넣지 않는다.

━━━━━━━━━━━━━━━━━━━━
9. 고정설정 / 로어와 현재상태 분리
━━━━━━━━━━━━━━━━━━━━

다음과 같은 장기간 변하지 않는 정보는 기본적으로 캐릭터 설정 또는 로어가 담당한다.

- 외형
- 기본 성격
- 종족/특수설정
- 일반적인 특수특성 원리
- 세계관 법칙
- 기본 직업 설명
- 일반적인 음식·취향
- 평소 습관
- 말투
- 소지품의 기본 기능

현재상태에는 전부 반복하지 않는다.

단, 다음 경우에는 현재상태에도 남긴다.

1. 최신 사건으로 기존 설정이 변경됨
2. 특수특성의 현재 제한이 중요한 상태
3. 실제 정보와 공식적으로 알려진 정보를 반드시 구분해야 함
4. 누가 해당 사실을 알고/모르는지가 중요함
5. AI가 자주 잘못 적용하는 설정임

예:

불필요:
- 특수 존재는 특정 환경에서 형태가 변한다.
- 변화한 형태의 외형은 특정 특징을 가진다.
- 특수 환경에서 빠르게 이동한다.

현재상태에서 필요한 경우:
- 완전 변형 직접목격=A·B·C.
- D는 직접목격 X, 보고만 받음.
- 현재 부상에 재생특수특성을 자동적용하지 않는다.

━━━━━━━━━━━━━━━━━━━━
10. 완료된 사건과 현재상태
━━━━━━━━━━━━━━━━━━━━

완료된 사건은 “그 사건의 결과가 현재도 살아 있는 경우”에만 현재상태에 남긴다.

상세한 원인→진행→대사→행동은 날짜별 로그요약으로 이동한다.

예:

과도한 현재상태:
- 5/10 13:00 출발
- 약속 장소 도착
- A가 먼저 대화 시작
- B가 뒤늦게 합류
- 약 40분 대화
- 마지막에 선물을 건넴

권장 현재상태:
- 5/10 A와의 약속=완료.
- PC는 대화를 통해 A의 현재 입장을 이해함.
- 선물=현재 PC 소지.

과거 사건이 다시 언급되는 장면에서는 해당 날짜 로그를 참조한다.

━━━━━━━━━━━━━━━━━━━━
11. 관계 현재상태 작성법
━━━━━━━━━━━━━━━━━━━━

관계 블록은 관계의 역사 전체가 아니라 현재 유효한 관계값을 기록한다.

가능하면 다음을 우선한다.

- 현재 실제 관계
- 공식연애 여부
- 독점 여부
- 성적 관계 여부
- 현재 호감·신뢰·갈등
- 최근 관계를 바꾼 결정적 사건의 결과
- 현재 미해결 문제
- PRIVATE 감정 중 후속 행동에 중요한 것
- 서로 알고 있는 정보
- 서로 모르는 정보

오래된 관계사건은 현재 관계를 설명하는 데 필요한 경우에만 1~2줄로 압축한다.

현재 상태가 특정 날짜의 중요한 사건으로 확정되었다면 날짜를 짧게 병기할 수 있다.
날짜는 사건 경위를 재서술하기 위한 것이 아니라 현재값의 기준점을 남기기 위한 용도로만 사용한다.

예:

[A ↔ PC]
- 서로 신뢰가 높아졌지만 관계 정의는 아직 미완료.
- 최신 사건에서 A가 PC에게 곁에 있겠다고 약속.
- A PRIVATE에서는 호감이 확인되지만 직접 고백하지 않음.
- 공식연애 X.
- 독점관계 X.
- PC는 A의 PRIVATE 감정을 모름.

다음처럼 관계 발전의 모든 증거를 나열하지 않는다.

- 첫 음식 제공
- 첫 문자
- 첫 이동동행
- 여러 차례 반복된 애정표현
- 과거 선물
- 과거 대화 전체

그러한 사건은 날짜별 로그요약에서 보존한다.

━━━━━━━━━━━━━━━━━━━━
12. 현재상태의 정보격차
━━━━━━━━━━━━━━━━━━━━

정보격차는 현재상태에서 최우선 보존한다.

가능하면 다음 종류를 분리한다.

[객관적 사실]
실제로 정사상 존재하는 사실.

[KNOWS]
해당 캐릭터가 직접 듣거나 목격하여 아는 사실.

[DOES NOT KNOW]
객관적으로 존재하지만 해당 캐릭터에게 전달되지 않은 사실.

[추측 / 의심]
증거는 있으나 캐릭터가 확정적으로 알지는 못하는 사실.

[미확정]
아직 직접 RP되지 않은 사실.

특히 다음 정보는 자동공유하지 않는다.

- 현장부재 중 발생한 사건
- PRIVATE 독백
- OOC 정보
- 다른 사람끼리의 대화
- 개인정보·사건 비밀
- 비밀 보관물
- 그룹 내부 정보
- 연인의 개인정보

같은 팀·연인·친구라는 이유만으로 자동으로 정보를 공유받았다고 기록하지 않는다.

현재상태는 모든 캐릭터 지식을 완전 열거하는 데이터베이스가 아니다.

특정 사실이 현재상태의 KNOWS 목록에 적혀 있지 않다는 이유만으로 해당 캐릭터가 그 사실을 모른다고 새로 확정하지 않는다.

DOES NOT KNOW는 직접 RP·기존 기록·현장부재 등으로 실제 정보격차가 확인되는 경우에만 기록한다.

정보격차가 과거 사건보다 후속 RP 연속성에 더 중요하다면 과거 사건 설명을 줄이고 정보격차를 우선한다.

━━━━━━━━━━━━━━━━━━━━
13. 물건 / 비밀 / 자산 상태
━━━━━━━━━━━━━━━━━━━━

중요 물건은 획득과정이 아니라 현재 상태를 우선 기록한다.

가능하면 다음을 표시한다.

- 현재 소유자
- 현재 보관장소
- 사용/소모 여부
- 분실 여부
- 누가 존재를 아는지
- 누가 위치를 아는지

예:

- 목걸이=A의 개인보관함 보관.
- PC는 현재 보관장소 모름.
- B·C에게 자동공유 X.

“어떻게 처음 획득했는가”가 필요하면 날짜별 로그요약에서 호출한다.

━━━━━━━━━━━━━━━━━━━━
14. 특수특성 / 활동 상태
━━━━━━━━━━━━━━━━━━━━

현재상태에서는 특수특성의 전체 설정집을 다시 작성하지 않는다.

다음만 우선 기록한다.

- 최신 검증 수준
- 새롭게 공개된 특수특성
- 현재 적용되는 제한
- 현재 부상과 충돌하는 특수특성
- 누가 직접 목격했는지
- 누가 보고만 받았는지
- 아직 검증되지 않은 부분

예:

- 재생특수특성 O.
- 과거 빠른 회복 전례 O.
- 현재 부상에 동일 속도 회복을 선반영하지 않는다.
- 직접목격=A·B·C.

특수특성의 일반 원리·외형·세부 설정은 캐릭터 설정/로어에 둔다.

━━━━━━━━━━━━━━━━━━━━
15. 현재 진행중 후크
━━━━━━━━━━━━━━━━━━━━

현재 후크는 “다음 RP에서 아직 결과가 바뀔 수 있는 것”만 남긴다.

우선순위:

1. 현재 진행 중인 장면
2. 아직 완료되지 않은 약속
3. 관계 정의·고백·갈등
4. 공개되지 않은 비밀
5. 미완료 사건·수사
6. 미해결 부상
7. 미확정 소유물·보상
8. 후속 행동이 필요한 사건
9. 아직 전달되지 않은 중요정보

이미 해결된 후크는 즉시 삭제한다.

완료된 사건의 결과만 현재에 영향을 미친다면 후크가 아니라 해당 현재상태 항목으로 이동한다.

예:

과거:
- A와 중요한 대화 예정.

실행 후:
→ 후크에서 삭제.
→ 필요하면 “A와의 대화 완료, 관계정의는 여전히 미완료”처럼 현재 결과만 유지.

━━━━━━━━━━━━━━━━━━━━
16. ANTI-DRIFT 작성법
━━━━━━━━━━━━━━━━━━━━

ANTI-DRIFT는 현재상태 본문의 요약본이 아니다.

본문과 같은 사실을 모두 한 번 더 반복하지 않는다.

AI가 실제로 자주 틀릴 가능성이 높은 “오류 방지용 최신값”만 짧고 강하게 고정한다.

우선 남길 것:

- 최신 시점·장소
- 최근 변경된 관계상태
- 완료/미완료가 자주 뒤집히는 사건
- 중요한 정보격차
- 공식연애/독점 여부
- 중요한 물건의 현재 소유자
- 특수특성·비밀정보의 목격자 구분
- 폐기된 과거 상태
- 사용자 캐릭터 선택 보호
- 자동 정보공유 금지

예:

- 최신=TXXX｜날짜｜장소｜WITH.
- A↔B=공식결별 완료. 관계유예 상태 폐기.
- PC는 해당 결별대화를 듣지 못해 공식결별 사실 KNOWS X.
- 목걸이=A 보관함 보관. B는 위치 KNOWS X.
- C=비밀대화 직접청취 X, A에게 핵심만 전달받음.
- D의 선물 준비=계획만 존재. 전달완료 X.
- 보호·질투·성적끌림 ≠ 공식연애/사랑/독점.
- PRIVATE·OOC·현장부재 정보 자동인지 금지.

ANTI-DRIFT에 완료된 사건의 전체 과정이나 관계역사를 다시 넣지 않는다.

━━━━━━━━━━━━━━━━━━━━
17. stale state 방지 규칙
━━━━━━━━━━━━━━━━━━━━

최신 RP에서 상태가 바뀌면 옛 상태를 현재상태에 병존시키지 않는다.

예:

과거:
A와 B는 공식연인.

최신:
A와 B 공식결별.

현재상태:
A↔B=공식결별 완료.
과거 약1년 교제.

다음처럼 쓰지 않는다.

A와 B는 공식연인.
하지만 최근 결별함.

현재상태는 현재 유효한 값을 우선한다.

과거 상태가 왜 바뀌었는지 필요한 경우 날짜별 로그요약에서 확인한다.

이 원칙은 다음에 모두 동일하게 적용한다.

- 연애
- 약속
- 사건
- 활동
- 합의
- 부상
- 소유물
- 신분
- 비밀공개
- 정보격차
- 특수특성 습득
- 수사
- 계획

━━━━━━━━━━━━━━━━━━━━
18. 현재상태 압축 원칙
━━━━━━━━━━━━━━━━━━━━

현재상태를 줄일 때는 ‘정보를 삭제할 것인가’가 아니라 ‘이 정보가 어느 기억층에 있어야 하는가’를 판단한다.

각 정보에 대해 다음 질문을 한다.

① 이 사실이 지금 다음 RP의 행동·관계·지식상태를 바꾸는가?
→ YES: 현재상태 유지.

② 지금은 직접 영향을 주지 않지만 과거 회상 시 필요할 수 있는가?
→ 날짜별 로그요약으로 이동.

③ 장기간 변하지 않는 캐릭터·세계관 기본설정인가?
→ 캐릭터 설정/로어로 이동.

④ 동일 사실을 현재상태 안에서 여러 번 반복하고 있는가?
→ 가장 적절한 한 위치에만 남긴다.

⑤ 사건의 원인·과정·결과 중 현재 필요한 것이 결과뿐인가?
→ 결과만 현재상태에 남긴다.

⑥ 해당 정보의 핵심이 “누가 알고 모르는가”인가?
→ 사건 설명보다 정보격차를 우선한다.

현재상태는 길수록 좋은 문서가 아니다.
다음 RP에 필요한 최신 정보의 신호가 과거 세부사항에 묻히지 않도록 구성한다.

━━━━━━━━━━━━━━━━━━━━
19. 현재상태 작성 시 절대 보존할 것
━━━━━━━━━━━━━━━━━━━━

압축하더라도 다음은 쉽게 제거하지 않는다.

- 최신 장면 앵커
- 현재 부상·신체여파
- 최신 관계전환
- 공식연애·독점·성적관계 여부
- 캐릭터별 정보격차
- 중요한 비밀
- 현재 소유물·보관장소
- 미완료 약속·계획
- 아직 전달되지 않은 중요정보
- 진행중 사건
- 현재 유효한 신분·소속
- 최신 특수특성 제한
- 사용자 캐릭터가 직접 확정한 감정·선택
- AI가 자주 틀리는 최신값

━━━━━━━━━━━━━━━━━━━━
20. 현재상태 문서 출력 방식
━━━━━━━━━━━━━━━━━━━━

현재상태는 수정사항 목록이나 패치노트가 아니라 매번 단독으로 사용할 수 있는 완전한 최신 교체본을 출력한다.

기존 현재상태의 최상단 고정 제목이 있다면 문자·이모지까지 정확히 유지한다.

예:
📝짱구 현재상태
📝철수 현재상태

기존 제목이 없다면 사용자가 쓰는 캐릭터명/프로젝트명 기준 제목을 유지한다.

문서 최상단 첫 줄 위에는 설명·인사·버전표기·작업보고를 넣지 않는다.

현재상태 본문 안에서 과거 로그를 장황하게 재서술하지 않는다.

기존 섹션 번호는 유지 의무가 없다.
최신 HOT MEMORY에 맞게 섹션을 추가·삭제·재배열할 수 있다.

정보가 사라진 이유를 설명하는 편집 메타문장은 쓰지 않는다.

━━━━━━━━━━━━━━━━━━━━
21. 현재상태 최종 검수 체크리스트
━━━━━━━━━━━━━━━━━━━━

현재상태 출력 전 반드시 확인한다.

□ 다음 턴을 바로 이어갈 최신 장면이 있는가?
□ 최신 턴·날짜·시간·장소·WITH가 맞는가?
□ 현재 부상·피로·취중 등 신체여파가 반영됐는가?
□ 최신 로그에 재언급되지 않았다는 이유로 지속 상태를 삭제하지 않았는가?
□ 과거 관계상태가 최신 관계상태와 함께 남아 있지 않은가?
□ 완료된 사건의 상세 과정이 불필요하게 반복되고 있지 않은가?
□ 고정 로어·외형·기본특수특성을 현재상태에 과도하게 복제하지 않았는가?
□ 관계 블록이 과거 사건 목록이 아니라 최신 관계값 중심인가?
□ 공식연애·독점·성적관계 여부가 필요한 경우 명확한가?
□ 캐릭터별 KNOWS / DOES NOT KNOW가 보존됐는가?
□ 현재상태에 없다는 이유만으로 새로운 DOES NOT KNOW를 만들지 않았는가?
□ 추측/의심과 객관적 사실이 섞이지 않았는가?
□ PRIVATE·OOC·현장부재 정보가 자동공유되지 않았는가?
□ 중요한 물건의 현재 소유자·보관상태가 맞는가?
□ 현재 후크에 이미 해결된 사건이 남아 있지 않은가?
□ 특수특성은 최신 검증수준과 현재 제한만 기록했는가?
□ 동일 사실이 여러 섹션과 ANTI-DRIFT에서 반복되고 있지 않은가?
□ ANTI-DRIFT가 오류방지값만 짧게 고정하고 있는가?
□ 현재상태에서 빠진 과거 경위가 날짜별 로그요약 또는 로어에 보존되어 있는가?
□ 최신 RP에서 폐기된 stale state가 남아 있지 않은가?
□ 사용자 캐릭터의 다음 감정·선택을 임의확정하지 않았는가?

━━━━━━━━━━━━━━━━━━━━
22. 최종 출력 규칙
━━━━━━━━━━━━━━━━━━━━

- 설명·인사·작업보고 없이 완성된 현재상태 교체본만 출력한다.
- 기존 고정 제목을 첫 줄에 그대로 유지한다.
- 최신 장면 앵커를 최상단에 둔다.
- 현재값에 직접 필요하지 않은 과거 사건 경위는 삭제하고 날짜별 로그로 넘긴다.
- 고정 세계관·외형·기본특수특성·일반취향은 필요한 경우만 짧게 남긴다.
- 관계는 현재 최신값 중심으로 쓴다.
- 정보격차·비밀·미완료 후크·중요 물건 상태를 우선한다.
- 완료된 후크는 삭제한다.
- stale state는 최신값으로 치환한다.
- ANTI-DRIFT는 본문 요약이 아니라 오류방지값만 기록한다.
- 현재상태는 길수록 좋은 문서가 아니다. 다음 RP에 필요한 HOT MEMORY만 남긴다.
- 결과 전체를 Markdown 코드블록으로 감싸지 않는다.`,
    logSummary: String.raw`# 날짜별 로그요약 최종 프롬프트

## 1. 작업 목적

입력된 기존 날짜별 로그요약, 신규 RP 로그, 기존 현재상태, 사용자 직접 정정·고정설정을 서로 비교하여 날짜별 로그요약을 갱신한다.

이 작업은 단순 줄거리 축약이 아니다.

날짜별 로그요약은 후속 RP에서 과거 사건을 다시 호출했을 때 사실·관계·행동 이유·정보격차·약속·비밀·특수특성 발현 경위를 정확히 복원할 수 있도록 보존하는 EPISODIC MEMORY다.

현재상태가 “지금 이 순간의 최신 HOT MEMORY”라면,
날짜별 로그요약은 “그 현재값이 어떻게 만들어졌는지 다시 찾을 수 있는 사건기록”이다.

즉,

현재상태 = 현재 정답표
날짜별 로그 = 그 정답이 만들어진 사건기록

으로 역할을 분리한다.

━━━━━━━━━━━━━━━━━━━━
2. 정사 판단 우선순위
━━━━━━━━━━━━━━━━━━━━

정보가 충돌하면 아래 순서로 판단한다.

1. 사용자 직접 정정·고정설정
2. 최신 직접 RP에서 실제로 발생한 사건
3. 동일 로그 안에서 명시적으로 확정된 사실
4. 확정 OOC / 세계관 / 로어
5. 최신 통합 현재상태
6. 기존 날짜별 로그요약
7. 기존 장기기억·관계현황
8. 캐릭터의 추측·오해·거짓말
9. AI의 추론

최신 정사가 옛 기록을 뒤집으면 낡은 상태를 최종값처럼 남기지 않는다.

AI가 과거 출력에서 실수한 내용, 사용자에게 정정된 내용, 덮어써진 시간·날짜·설정은 정사로 남기지 않는다.

날짜 요약에는
“AI가 처음에는 A라고 했지만 이후 B로 수정됨”
“이전 출력과 충돌함”
같은 편집·교정 메타정보를 쓰지 않는다.

정답만 자연스럽게 반영한다.

━━━━━━━━━━━━━━━━━━━━
3. 기존 현재상태 사용 제한
━━━━━━━━━━━━━━━━━━━━

기존 현재상태는 최신 정사·현재 유효값을 검증하기 위한 참고자료다.

현재상태에 어떤 사실이 존재한다는 이유만으로
그 사실의 발생 날짜·발생 장면·전달 과정·원인을 과거 날짜 로그에 새로 만들어 넣지 않는다.

날짜 로그에 사건의 경위를 기록하려면
신규 RP 로그, 기존 날짜별 로그요약 또는 사용자 직접 정정에서
해당 사건의 날짜·행동·전달 과정에 대한 근거가 확인되어야 한다.

현재상태는 누락된 과거 사건을 추측해 복원하는 자료가 아니다.

현재상태와 로그가 충돌할 경우 정사 판단 우선순위에 따라 최신 정답을 사용하되,
근거가 없는 과거 경위를 새로 창작하지 않는다.

━━━━━━━━━━━━━━━━━━━━
4. 사용자 캐릭터 보호 / 과잉추론 금지
━━━━━━━━━━━━━━━━━━━━

사용자 캐릭터(PC)의 감정·의도·욕망·관계선택은 직접 RP나 사용자 정정으로 확정된 범위만 기록한다.

다음은 금지한다.

- 행동만 보고 사랑·질투·성적욕망을 자동확정
- 수면 중 행동을 의식적 선택으로 확대
- NPC의 PRIVATE 감정을 PC가 안다고 처리
- OOC·서술자 정보·타인 독백을 캐릭터 지식으로 전환
- 같은 팀·연인·친구라는 이유로 비밀을 자동공유
- 아직 RP되지 않은 미래 행동·선택·감정을 미리 확정

현장부재·수면·의식 없음·대화 불참 상태의 캐릭터는 직접 전달받지 않은 정보를 자동으로 알지 못한다.

━━━━━━━━━━━━━━━━━━━━
5. 날짜별 로그요약의 역할
━━━━━━━━━━━━━━━━━━━━

현재상태에서 압축·제외된 과거 사건의 경위는 날짜별 로그요약이 담당한다.

다음 정보는 현재상태에서 빠지더라도 날짜별 로그요약 안에서는 충분히 보존한다.

- 현재 관계가 만들어진 과정
- 특수특성·비밀정보가 처음 공개된 장면
- 누가 무엇을 직접 목격했는지
- 누가 어떤 말을 직접 들었는지
- 중요한 물건을 언제·어떻게 얻었는지
- 약속·합의·결별·관계정의가 성립된 실제 과정
- 현재 감정이나 행동패턴이 형성된 계기
- 완료된 사건의 실제 진행과 결과
- 이후 회상·재언급 가능성이 높은 사건
- 현재 정보격차가 생긴 이유

━━━━━━━━━━━━━━━━━━━━
6. 날짜별 로그요약 기본 형식
━━━━━━━━━━━━━━━━━━━━

기본 형식:

[날짜-사건명·사건명·사건명]
본문

예:
[5월 10일-철수첫약속·유리갈등·목걸이선물]
오전 사용자 캐릭터는 철수와 약속한 장소에 도착했고...

중요 형식 규칙:

- 제목과 본문 사이에 빈 줄을 넣지 않는다.
- 제목 바로 다음 줄부터 본문을 시작한다.
- 서로 다른 날짜 블록 사이는 가독성을 위해 빈 줄 1줄로 구분한다.
- 같은 날짜 블록 내부 본문은 여러 문단으로 나누지 않고 하나의 연속된 문단으로 작성한다.
- 문단 중간에 소제목·번호·구분선을 넣지 않는다.
- 다음 날짜가 시작될 때만 새 [날짜-키워드] 블록을 시작한다.
- 날짜별 로그 끝에 “최신 T120은...”, “현재 최신 장면은...”, “이 날짜의 마지막 장면은...” 같은 메타 장면정리 문장을 붙이지 않는다.
- 최신 턴·장소·WITH·진행 중 행동은 현재상태 문서에서 관리한다.

연도가 직접 확정되어 있으면 [YYYY년 M월 D일-...] 형식을 우선한다.
특히 여러 해가 흐르는 장기 RP에서는 같은 월·일의 중복을 피하기 위해 연도가 확인되는 모든 날짜 블록에 연도를 반드시 포함한다.
연도가 확정되지 않았다면 임의로 만들지 말고 [M월 D일-...]을 유지한다.
날짜 자체가 정사상 미상인 사건은 [날짜 미상-사건명] 형식으로 유지할 수 있으며 임의 날짜를 창작하지 않는다.

제목은 단순 분위기 표현보다 나중에 다시 검색하기 좋은 고유명사와 사건명을 우선한다.

우선 사용할 키워드:

- NPC 정확한 이름
- 그룹·조직명
- 장소명
- 사건명
- 물건명
- 특수특성명
- 관계전환 사건
- 비밀 공개
- 부상·구조·폭행
- 고백·결별·첫키스
- 합의·약속
- 사건을 대표하는 고유명사

좋음:
[5월 10일-철수첫약속·유리갈등·목걸이선물]

나쁨:
[5월 10일-복잡한하루·감정변화·여러사건]

🪽위시 RP Manager의 관련 로그 자동검색에서 다시 찾기 쉬운 표현을 우선한다.

━━━━━━━━━━━━━━━━━━━━
7. 날짜 처리
━━━━━━━━━━━━━━━━━━━━

- 같은 날짜의 사건은 기본적으로 하나의 날짜 블록으로 통합한다.
- 같은 날짜 안에서 사건이 여러 개여도 본문은 한 문단으로 유지하되, 문장 흐름으로 원인→행동→결과를 자연스럽게 연결한다.
- 장소가 바뀌었다는 이유만으로 날짜 블록을 쪼개지 않는다.
- 등장인물이 바뀌었다는 이유만으로 자동 분리하지 않는다.
- 서로 이어지는 원인→행동→결과는 반드시 같은 흐름으로 묶는다.
- 날짜가 확정된 사건은 ‘오늘·어제·다음날’ 같은 상대시간만으로 기록하지 않고 실제 날짜를 우선한다.
- 시간대가 중요하면 오전·오후·새벽·밤 정도를 보존한다.
- 정확한 시각이 연속성에 중요하지 않다면 분 단위 시간을 억지로 남기지 않는다.
- 날짜가 확정되지 않았다면 임의 계산하여 만들지 않는다.

신규 로그가 기존 요약의 마지막 날짜와 겹치면 기존 문장 뒤에 단순 덧붙이지 않는다.

해당 날짜 전체를 다시 검토하여 최신 사건까지 반영한 완성본으로 교체한다.

새 사건 때문에 과거 사건의 의미가 달라졌다면 기존 날짜 요약의 표현도 최신 정사에 맞게 수정한다.

예:

과거:
A↔B 관계유예.

최신 같은 날짜 후반:
A↔B 공식결별.

→ 해당 날짜 완성본에서는 관계유예를 최종상태처럼 남기지 않고 “유예 상태에서 공식결별로 전환”이라는 사건 흐름으로 기록한다.

사용자가 전체 로그를 다시 달라고 하지 않았다면 기본 출력은 신규 날짜 블록과 교체가 필요한 날짜 블록만 출력한다.

━━━━━━━━━━━━━━━━━━━━
8. 날짜별 로그요약 분량
━━━━━━━━━━━━━━━━━━━━

날짜별 로그요약은 사건의 밀도와 중요도에 따라 분량을 가변적으로 조절한다.

권장 기준:

- 사건이 적은 날: 600~900자
- 일반적인 날: 1,000~1,500자
- 중요 사건이 몰린 날: 1,500~1,800자
- 아주 복잡한 날: 약 2,000자를 권장 상한으로 삼는다.

단, 핵심 사건의 인과·관계 변화·정보격차가 손실되는 경우에는 2,000자에 억지로 맞추기 위해 중요정보를 삭제하지 않는다.

글자수를 맞추기 위해 의미 없는 묘사를 추가하지 않는다.
사건이 적으면 짧게 끝내고, 중요한 사건이 많으면 필요한 만큼 충분히 기록한다.

분량 배분 우선순위:

1. 관계를 실제로 바꾼 사건
2. 정보격차를 만든 사건
3. 비밀 공개·획득·은폐
4. 중요한 선택·약속·합의
5. 중요한 설정·특성의 최초 공개 또는 변화
6. 현재까지 영향을 남긴 부상·물건·사건
7. 이후 반복되는 행동패턴의 최초 계기
8. 일반 대화·분위기 묘사

모든 장면을 균등하게 요약하지 않는다.

판단 기준은 다음과 같다.

“이 날짜에 핵심 사건이 몇 개나 있으며,
그 사건들의 원인·선택·결과·정보격차를 복원하려면 어느 정도 분량이 필요한가?”

분량보다 연속성과 검색 가능성을 우선한다.

━━━━━━━━━━━━━━━━━━━━
9. 날짜별 로그에서 반드시 보존할 사건 구조
━━━━━━━━━━━━━━━━━━━━

중요 사건은 가능하면 다음 구조를 보존한다.

상황 / 원인
→ 누가 무엇을 했는가
→ 누가 무엇을 직접 말했는가
→ 상대가 어떻게 반응했는가
→ 실제 결과
→ 관계 또는 상태가 어떻게 바뀌었는가
→ 누가 무엇을 새로 알게 되었는가
→ 누가 여전히 모르는가
→ 이후 남은 후크

모든 사건에 모든 항목을 억지로 넣을 필요는 없다.

하지만 사건의 결과만 적어서 “왜 현재 상태가 이렇게 되었는지” 알 수 없게 만들지 않는다.

━━━━━━━━━━━━━━━━━━━━
10. 현재상태에서 빠진 과거 관계사는 로그에서 보존
━━━━━━━━━━━━━━━━━━━━

현재상태의 인물별 관계 블록은 현재 최신 관계값 중심으로 압축한다.

따라서 날짜별 로그에서는 그 관계값을 만든 중요한 사건을 보존한다.

예:

현재상태:
- A↔PC=높은 생활밀착·감정적 위로 관계.
- A PRIVATE=강한 성적 끌림·독점욕.
- 공식연애 X.

날짜별 로그에는 필요에 따라 다음을 보존할 수 있다.

- A가 처음 생활보호를 맡은 계기
- 학습도구 제공으로 언어습득을 도운 사건
- 특수한 정체·형태를 처음 직접 목격한 사건
- 첫 문자·연락 교류
- PC가 처음 울었을 때 품에 안아 위로한 사건
- 관계의 의미가 달라진 중요한 신체접촉·약속

단순히 접촉 횟수를 나열하는 것이 아니라 현재 관계를 형성하거나 바꾼 사건만 남긴다.

━━━━━━━━━━━━━━━━━━━━
11. 정보격차 생성 과정을 상세히 보존
━━━━━━━━━━━━━━━━━━━━

날짜별 로그에서는 “누가 무엇을 안다”뿐 아니라 그 지식이 어떻게 생겼는지도 중요하게 기록한다.

특히 다음을 구분한다.

[직접목격]
캐릭터가 현장에서 직접 봄.

[직접청취]
당사자에게 직접 들음.

[보고]
다른 캐릭터에게 전달받음.

[추측 / 의심]
정황을 보고 그렇게 생각함.

[미전달]
객관적으로 사실이 존재하지만 해당 캐릭터에게 전달되지 않음.

예:

- A·B·C는 현장에서 PC의 특수한 변화를 직접목격함.
- D는 당시 현장에 없어 직접목격하지 못했으며 이후 A·B·C에게 핵심 특징을 보고받음.
- E는 검사로 일반적 기준과 다른 생리특성만 확인했으며 실제 정체명은 전달받지 못함.

이 구분은 현재상태가 압축되더라도 날짜별 로그에서 반드시 보존한다.

━━━━━━━━━━━━━━━━━━━━
12. 최초 발생 / 최초 공개 / 최초 경험 보존
━━━━━━━━━━━━━━━━━━━━

현재상태에서는 “현재 가능한가 / 누가 아는가”만 남을 수 있으므로 날짜별 로그에서는 중요한 최초 사건을 적극적으로 보존한다.

예:

- 첫 만남
- 첫 구조
- 첫 키스
- 첫 성관계
- 첫 특정 성적 경험
- 첫 울음
- 첫 고백
- 첫 질투가 직접 행동으로 나타난 사건
- 첫 특수특성 사용
- 첫 비밀정보 공개
- 첫 특수형태 목격
- 첫 전화
- 첫 문자
- 첫 사건 참여
- 첫 부상
- 첫 살인
- 첫 배신
- 첫 합의
- 첫 거짓말 적발

“현재는 이미 익숙한 행동”이라도 그 행동이 처음 형성된 사건은 향후 회상·관계서사에서 가치가 높으므로 보존한다.

━━━━━━━━━━━━━━━━━━━━
13. 반복 습관은 형성 과정만 로그에서 보존
━━━━━━━━━━━━━━━━━━━━

현재상태에서는 현재 유효한 습관이나 취향만 짧게 남긴다.

날짜별 로그에서는 그 습관이 형성된 중요한 최초·강화 사건을 보존한다.

이후 동일 행동이 반복될 때마다 모두 기록할 필요는 없다.

다만 특정 반복행동이 고백·갈등·위로·관계전환과 결합됐다면 별도의 중요한 사건으로 보존한다.

━━━━━━━━━━━━━━━━━━━━
14. 특수특성 / 비밀정보는 설정보다 발현 사건을 보존
━━━━━━━━━━━━━━━━━━━━

고정 특수특성의 일반 원리는 캐릭터 설정/로어가 담당한다.

날짜별 로그에서는 다음을 기록한다.

- 언제 처음 사용했는가
- 어떤 상황에서 사용했는가
- 실제로 어디까지 가능했는가
- 누가 목격했는가
- 어떤 결과가 생겼는가
- 기존에 몰랐던 새로운 특성이 확인됐는가
- 어떤 정보격차 변화가 생겼는가

예:

로어:
PC는 비정상적인 괴력을 가진 특수 존재임.

날짜 로그:
PC가 폭행당한 뒤 상대를 직접 공격하지 않고 힘을 억제하는 과정에서 단단한 가구를 손으로 파손함. 상대 NPC가 이를 직접 목격해 PC의 비정상적 신체능력을 의심할 근거를 얻었으나 실제 정체는 알지 못함.

이처럼 특수특성 설명 자체보다 서사 안에서 실제로 드러난 증거를 보존한다.

━━━━━━━━━━━━━━━━━━━━
15. 완료된 사건은 로그에서 충분한 경위를 보존
━━━━━━━━━━━━━━━━━━━━

현재상태에서는 완료된 사건을 결과 중심으로 짧게 남긴다.

날짜별 로그에서는 후속 RP에서 재참조할 가치가 있는 경위를 보존한다.

특히 다음은 완료됐더라도 상세도를 지나치게 줄이지 않는다.

- 중요한 만남
- 다툼·화해
- 이별·고백
- 약속·합의
- 배신·비밀공개
- 중요한 선택
- 특수한 사건
- 큰 부상
- 관계·소속 변화
- 임무·훈련·수사 등 후속 플롯에 영향을 주는 활동

현재상태에서 결과만 남더라도 날짜 로그 하나를 다시 읽으면 사건의 원인·선택·결과를 복원할 수 있어야 한다.

━━━━━━━━━━━━━━━━━━━━
16. 물건 / 소유물의 이력 보존
━━━━━━━━━━━━━━━━━━━━

현재상태에서는 중요 물건의 현재 소유자·보관장소만 우선한다.

날짜별 로그에서는 필요에 따라 다음을 보존한다.

- 최초 획득
- 누구에게 받았는가
- 누구에게 넘겼는가
- 숨긴 이유
- 보관장소 변경
- 분실
- 회수
- 파손
- 실제 사용
- 존재를 아는 인물

현재 소유 상태만으로는 복원할 수 없는 물건의 서사적 의미를 날짜 로그에서 보존한다.

━━━━━━━━━━━━━━━━━━━━
17. 중요한 대사는 정확한 의미를 보존
━━━━━━━━━━━━━━━━━━━━

모든 대사를 그대로 기록하지 않는다.

다만 아래에 해당하면 직접 대사 또는 의미가 훼손되지 않는 수준의 인용을 우선한다.

- 고백
- 거절
- 결별
- 관계 정의
- 약속
- 허락
- 금지
- 경고
- 사과
- 합의
- 비밀 공개
- 중요한 선택
- 캐릭터의 의사·입장·선택을 명확하게 확정하는 말

예:

B가 “우리 이제 끝이야.”라고 명시적으로 말해 관계유예가 아닌 공식결별을 확정함.

이런 대사는 현재상태에서 “공식결별”만 남더라도 날짜 로그에서는 근거로 보존한다.

━━━━━━━━━━━━━━━━━━━━
18. PRIVATE 감정과 객관적 행동을 구분
━━━━━━━━━━━━━━━━━━━━

NPC의 PRIVATE 독백·내면이 직접 출력되었다면 후속 RP에서 행동 원인을 설명할 가치가 있을 때 보존할 수 있다.

단 반드시 캐릭터 지식과 분리한다.

예:

- A PRIVATE에서는 PC에 대한 강한 성적끌림·독점욕이 확인됨.
- PC는 해당 내면을 듣거나 확인한 적 없어 KNOWS X.

PRIVATE 감정을 기록했다고 해서 그 감정이 상대에게 전달됐다고 쓰지 않는다.

감정은 실제 행동·관계 변화에 영향을 주는 경우에 우선 보존한다.
순간적인 감상이나 반복 독백은 줄인다.

━━━━━━━━━━━━━━━━━━━━
19. 미완료 후크의 발생 원인 보존
━━━━━━━━━━━━━━━━━━━━

현재상태에는 현재 남아 있는 후크 자체를 기록한다.

날짜 로그에서는 그 후크가 왜 생겼는지 보존한다.

예:

현재상태:
- A가 준비 중인 선물=아직 전달 전.
- PC는 선물 준비 사실을 모름.

날짜 로그:
- 어떤 사건을 계기로 A가 선물을 준비하기 시작했는지
- 누구와 준비 내용을 상의했는지
- 현재 어디까지 준비됐는지
- PC가 해당 대화에 없어서 아직 모른다는 점

후속 RP에서 후크가 다시 활성화되었을 때 날짜 로그 하나만 읽어도 원래 맥락을 복원할 수 있어야 한다.

━━━━━━━━━━━━━━━━━━━━
20. 성적 장면 로그요약 기준
━━━━━━━━━━━━━━━━━━━━

성적 장면은 현재상태에서 현재 관계·경계·신체여파·새로 확정된 취향 정도로 압축될 수 있다.

따라서 날짜별 로그에서는 후속 연속성에 필요한 사건 경위를 더 충실히 보존한다.

반드시 확인할 항목:

1. 참여자
2. 누가 시작했는지
3. 요청·수락·거절·중단
4. 실제 경계와 안전신호
5. 중요한 진행순서
6. 중간 합류·이탈
7. 처음 경험한 행위
8. 새롭게 확인된 선호·비선호
9. 후속 RP에 의미 있는 절정·사정 방식
10. 흔적·통증·피로 등 다음 장면에 남은 여파
11. 애프터케어
12. 이후 관계 변화
13. 누가 해당 사실을 알고/모르는지

모든 신체묘사를 보존하는 것이 목적이 아니다.

목표는 “나중에 이 사건이 다시 언급됐을 때 누가 무엇을 했고 어떤 경계와 결과가 있었는지” 정확히 복원하는 것이다.

성관계 자체를 연애·사랑·독점·용서의 증거로 자동해석하지 않는다.

━━━━━━━━━━━━━━━━━━━━
21. 검색 호출을 위한 로그 작성 규칙
━━━━━━━━━━━━━━━━━━━━

날짜별 로그는 이후 🪽위시 RP Manager의 관련 과거 로그 자동호출에 사용될 수 있다.

따라서 검색성을 의식하여 작성한다.

- 대명사보다 정확한 이름을 사용한다.
- 사건명은 일반어보다 고유명사를 우선한다.
- 그룹·조직·장소·물건의 정확한 이름을 남긴다.
- 중요한 캐릭터 이름을 최소 한 번은 명시한다.
- 제목과 본문의 핵심 키워드를 지나치게 추상적으로 쓰지 않는다.
- 관계 사건이면 양쪽 인물명을 가능하면 명시한다.
- 임무·사건이면 사건명·장소·목표를 남긴다.
- 물건 사건이면 물건명을 명시한다.
- 비밀정보/특수특성 사건이면 해당 특수특성 또는 설정명을 명시한다.
- 캐릭터·그룹·장소·물건은 가능하면 설정에서 사용하는 표준 이름을 사용한다.
- RP에서 애칭·약칭만 등장했더라도 동일인임이 확정되어 있다면 본문 어딘가에 표준 이름을 최소 1회 함께 기록한다.
- 같은 대상을 날짜마다 서로 다른 명칭으로만 기록하지 않는다.

검색성을 높인다는 이유로 실제 로그에 없는 신원·정체·별칭·사건·설정을 창작하지 않는다.

━━━━━━━━━━━━━━━━━━━━
22. 날짜 간 정보 반복 방지
━━━━━━━━━━━━━━━━━━━━

이전 날짜에서 이미 충분히 기록된 고정사실을 후속 날짜마다 처음부터 다시 설명하지 않는다.

후속 날짜에는 그 사실이 새로운 사건·관계·정보격차에 실제 영향을 준 경우에만 필요한 만큼 회수한다.

예:

5/10:
A가 B의 비밀정체를 처음 알게 된 경위를 상세히 기록.

5/12:
A가 이미 정체를 알고 있다는 사실만 필요한 경우 정체공개 과정을 반복하지 않고 “A는 5/10부터 B의 정체를 KNOWS” 정도로 연결한다.

단, 새로운 캐릭터가 같은 비밀을 처음 알게 되었거나 기존 정보의 의미·공개범위가 달라졌다면 새로운 사건으로 상세히 기록한다.

━━━━━━━━━━━━━━━━━━━━
23. 로그요약에서 압축해도 되는 것
━━━━━━━━━━━━━━━━━━━━

현재상태가 압축됐다고 해서 날짜 로그까지 모든 세부를 남길 필요는 없다.

다음은 계속 압축 가능하다.

- 반복되는 인사
- 의미 없는 이동
- 반복 식사
- 단순 잡담
- 같은 의미의 위로 반복
- 같은 행동의 반복
- 장식적 풍경묘사
- 관계를 바꾸지 않는 감탄
- AI의 과장된 수사
- 이후 언급될 가능성이 낮은 일회성 소품
- 관계나 정보상태에 영향 없는 미세한 표정 변화

판단 기준:

“이 세부가 사라지면 나중에 과거 사건을 다시 불러왔을 때 사실·관계·행동 이유·정보격차를 잘못 복원할 가능성이 있는가?”

YES → 남긴다.
NO → 압축한다.

━━━━━━━━━━━━━━━━━━━━
24. 날짜별 로그에서 금지할 메타 문장
━━━━━━━━━━━━━━━━━━━━

날짜 로그는 사건기록이지 현재 장면 앵커가 아니다.

따라서 아래 유형의 문장을 날짜 블록 끝에 붙이지 않는다.

- “최신 T120은 네 명 전원이 105호에 있는 장면이다.”
- “현재 최신 장면은 T206이다.”
- “이 날짜의 마지막 턴은 ○○이다.”
- “최신 시점 기준 ○○하고 있다.”
- “다음 RP는 여기서 이어진다.”

최신 턴·현재 위치·WITH·진행 중 행동은 현재상태에서만 관리한다.

날짜 로그의 마지막 문장은 해당 날짜 사건의 실제 결과·관계 변화·정보격차·남은 후크 중 하나로 자연스럽게 끝낸다.

━━━━━━━━━━━━━━━━━━━━
25. 날짜별 로그 최종 검수
━━━━━━━━━━━━━━━━━━━━

출력 전 각 날짜 블록에 대해 확인한다.

□ 제목 바로 다음 줄에 본문이 시작되는가?
□ 제목과 본문 사이 빈 줄이 없는가?
□ 같은 날짜 본문이 한 개의 연속 문단인가?
□ 최신 T... 같은 메타 장면정리 문장이 없는가?
□ 현재상태에서 빠진 중요한 사건 경위가 로그에 남아 있는가?
□ 현재 관계가 형성된 핵심 사건이 보존됐는가?
□ 결과뿐 아니라 중요한 원인과 선택이 남았는가?
□ 누가 직접 목격/청취/보고받았는지가 구분됐는가?
□ 누가 여전히 모르는지도 필요하면 기록됐는가?
□ 첫 경험·첫 공개·첫 특수특성 발현을 놓치지 않았는가?
□ 중요한 대사의 의미가 훼손되지 않았는가?
□ 물건의 획득·이동·보관 경위가 필요할 경우 남아 있는가?
□ 완료된 주요 사건의 실제 경위를 지나치게 삭제하지 않았는가?
□ PRIVATE 정보가 상대 캐릭터 지식으로 섞이지 않았는가?
□ 미해결 후크가 생긴 이유를 나중에 복원할 수 있는가?
□ 제목에 다시 검색하기 좋은 인물·장소·사건·물건 키워드가 있는가?
□ 대명사 때문에 검색성이 떨어지지 않는가?
□ 최신 정사와 충돌하는 오래된 상태가 최종값처럼 남지 않았는가?
□ 사용자 캐릭터의 감정·의도를 과잉추론하지 않았는가?
□ 불필요한 묘사를 줄이면서도 사건의 인과는 보존했는가?

━━━━━━━━━━━━━━━━━━━━
26. 최종 출력 규칙
━━━━━━━━━━━━━━━━━━━━

- 설명·인사·작업보고 없이 날짜 블록만 출력한다.
- 신규 날짜는 새 블록으로 추가한다.
- 기존 마지막 날짜와 겹치면 해당 날짜를 최신 정사 기준 완성본으로 교체한다.
- 사용자가 전체 로그를 요청하지 않았다면 변경·신규 날짜만 출력한다.
- 날짜 제목 바로 다음 줄부터 본문을 시작한다.
- 제목과 본문 사이에는 빈 줄을 넣지 않는다.
- 서로 다른 날짜 블록 사이는 빈 줄 1줄로 구분한다.
- 한 날짜 본문은 하나의 연속 문단으로 작성한다.
- 최신 턴·현재 위치·WITH를 날짜 로그 마지막에 덧붙이지 않는다.
- 결과 전체를 Markdown 코드블록으로 감싸지 않는다.`,
  });

  const GUIDE_STORAGE_KEYS = Object.freeze({
    currentState: 'RPCM_guide_currentState_v1',
    logSummary: 'RPCM_guide_logSummary_v1',
  });

  const GUIDE_COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';

  const SLOT_TEMPLATE = [
    { id: 'currentState', title: '현재상태', group: 'fixed', enabled: true, content: '', retentionTurns: 5 },
    { id: 'logSummary', title: '로그요약', group: 'fixed', enabled: true, content: '', retentionTurns: 5 },
    { id: 'extra-default', title: '기타', group: 'extra', enabled: false, content: '', retentionTurns: 5 },
  ];

  const state = {
    db: null,
    currentChatId: null, // 저장 범위 키(채팅방/분기별)
    currentApiChatId: null, // Crack API가 사용하는 실제 chatRoomId
    currentRoom: null,
    modal: null,
    fab: null,
    recovering: false,
    lastUrl: location.href,
    modalPos: null,
    domObserver: null,
    domSanitizeTimer: null,
    domSanitizing: false,
    autoSaveTimers: new Map(),
    idleAutoScanAt: new Map(),
    routeEpoch: 0,
    lastSavedAt: 0,
    saveStatus: 'saved',
  };

  function migrateStoredGuideText(slotId, value) {
    let text = String(value || '');
    if (slotId === 'currentState') {
      const oldTitles = [
        '# 캐릭터챗 최신 통합 현재상태 업데이트 장르중립 범용 최종 프롬프트',
        '# 캐릭터챗 최신 통합 현재상태 업데이트 범용 최종 프롬프트',
        '# 캐릭터챗 최신 통합 현재상태 업데이트 최종 프롬프트',
      ];
      for (const oldTitle of oldTitles) {
        if (text.startsWith(oldTitle)) {
          text = '# 현재상태 업데이트 최종 프롬프트' + text.slice(oldTitle.length);
          try { localStorage.setItem(GUIDE_STORAGE_KEYS[slotId], text); } catch (_) {}
          break;
        }
      }
    }
    return text;
  }

  function getGuideText(slotId) {
    if (!DEFAULT_GUIDES[slotId]) return '';
    try {
      const saved = localStorage.getItem(GUIDE_STORAGE_KEYS[slotId]);
      return saved === null ? DEFAULT_GUIDES[slotId] : migrateStoredGuideText(slotId, saved);
    } catch (_) { return DEFAULT_GUIDES[slotId]; }
  }

  function saveGuideText(slotId, value) {
    if (!DEFAULT_GUIDES[slotId]) return;
    try { localStorage.setItem(GUIDE_STORAGE_KEYS[slotId], String(value || '')); } catch (_) {}
  }

  function resetGuideText(slotId) {
    if (!DEFAULT_GUIDES[slotId]) return '';
    try { localStorage.removeItem(GUIDE_STORAGE_KEYS[slotId]); } catch (_) {}
    return DEFAULT_GUIDES[slotId];
  }

  async function copyPlainText(value) {
    const text = String(value || '');
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) { return false; }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function cloneSlots() {
    return SLOT_TEMPLATE.map(x => ({ ...x }));
  }

  function makeDynamicSlot(group, title) {
    const id = `${group}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return { id, title, group, aliases: [], enabled: false, content: '', retentionTurns: APP.defaultRetentionTurns, autoExcluded: false, autoPinned: false };
  }

  function normalizeRoomSlots(room) {
    const old = Array.isArray(room.slots) ? room.slots : [];
    const oldById = new Map(old.map(x => [x.id, x]));
    const legacyRetention = normalizeRetentionTurns(room.retentionTurns);

    const normalizeSlot = (slot, fallback) => ({
      ...fallback,
      ...(slot || {}),
      retentionTurns: normalizeRetentionTurns(slot?.retentionTurns ?? legacyRetention),
      aliases: Array.isArray(slot?.aliases) ? slot.aliases : (fallback.aliases || []),
      autoExcluded: !!slot?.autoExcluded,
      autoPinned: !!slot?.autoPinned,
    });

    const currentState = normalizeSlot(oldById.get('currentState'), { ...SLOT_TEMPLATE[0], group: 'fixed', title: '현재상태' });
    currentState.group = 'fixed'; currentState.title = '현재상태';
    const logSummary = normalizeSlot(oldById.get('logSummary'), { ...SLOT_TEMPLATE[1], group: 'fixed', title: '로그요약' });
    logSummary.group = 'fixed'; logSummary.title = '로그요약';
    const dynamic = [];

    for (const slot of old) {
      if (!slot || ['currentState','logSummary'].includes(slot.id)) continue;
      const content = String(slot.content || '');
      if (slot.group === 'character' || slot.group === 'extra') {
        dynamic.push(normalizeSlot(slot, makeDynamicSlot(slot.group, slot.title || (slot.group === 'character' ? '캐릭터' : '기타'))));
        continue;
      }
      // v0.1/v0.2 데이터가 있다면 버리지 않고 새 구조로 옮깁니다.
      if (slot.id === 'characterSettings' && content.trim()) {
        dynamic.push(normalizeSlot({ ...makeDynamicSlot('character', slot.title || '캐릭터 설정집(기존)'), enabled: !!slot.enabled, content }, {}));
      } else if (['extra1','extra2'].includes(slot.id) && content.trim()) {
        dynamic.push(normalizeSlot({ ...makeDynamicSlot('extra', slot.title || '기타'), enabled: !!slot.enabled, content }, {}));
      } else if (['longMemory','userRules'].includes(slot.id) && content.trim()) {
        dynamic.push(normalizeSlot({ ...makeDynamicSlot('extra', slot.title || '기존 메모'), enabled: false, content }, {}));
      }
    }

    if (!dynamic.some(x => x.group === 'extra')) dynamic.push({ ...SLOT_TEMPLATE[2] });
    room.slots = [currentState, logSummary, ...dynamic];
    delete room.retentionTurns; // v0.6부터 유지 주기는 항목별로 관리

    // v0.7 자동 기억 호출 설정: 기존 방은 보수적으로 OFF에서 시작합니다.
    room.autoCharacterDetection = !!room.autoCharacterDetection;
    room.autoCharacterLibraryId = String(room.autoCharacterLibraryId || '');
    room.autoCharacterResetOnReappear = room.autoCharacterResetOnReappear !== false;
    room.autoLogRecallEnabled = !!room.autoLogRecallEnabled;
    room.autoLogRecentBlocks = [1,2].includes(Number(room.autoLogRecentBlocks)) ? Number(room.autoLogRecentBlocks) : APP.defaultRecentLogBlocks;
    room.autoLogRelatedBlocks = [1,2,3,4].includes(Number(room.autoLogRelatedBlocks)) ? Number(room.autoLogRelatedBlocks) : APP.defaultRelatedLogBlocks;
    room.autoLogPinnedKeys = Array.isArray(room.autoLogPinnedKeys) ? [...new Set(room.autoLogPinnedKeys.map(String))] : [];
    room.autoLogExcludedKeys = Array.isArray(room.autoLogExcludedKeys) ? [...new Set(room.autoLogExcludedKeys.map(String))] : [];
    room.manualLogSelectedKeys = Array.isArray(room.manualLogSelectedKeys) ? [...new Set(room.manualLogSelectedKeys.map(String))] : [];
    // v0.8부터 날짜 블록이 감지되는 기존 장기 로그는 통짜 주입 대신 안전한 분할 자동 호출로 1회 마이그레이션합니다.
    if (!room.logRepositoryModeV08) {
      room.logRepositoryModeV08 = true;
      if (String(logSummary.content || '').trim() && parseDatedLogBlocks(logSummary.content).length) room.autoLogRecallEnabled = true;
    }
    room.autoScanLastMessageId = String(room.autoScanLastMessageId || '');
    room.autoRecallContextText = String(room.autoRecallContextText || '');
    return room;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function pendingBackupKey(chatId) {
    return `RPCM_pending_backup_${chatId}`;
  }

  function savePendingBackup(chatId, pending) {
    try { localStorage.setItem(pendingBackupKey(chatId), JSON.stringify(pending)); } catch (_) {}
  }

  function loadPendingBackup(chatId) {
    try {
      const raw = localStorage.getItem(pendingBackupKey(chatId));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearPendingBackup(chatId) {
    try { localStorage.removeItem(pendingBackupKey(chatId)); } catch (_) {}
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
    return null;
  }

  function getChatIdFromPath(pathname = location.pathname) {
    let m = pathname.match(/^\/stories\/[^/]+\/episodes\/([^/?#]+)/);
    if (m) return m[1];
    m = pathname.match(/^\/characters\/[^/]+\/chats\/([^/?#]+)/);
    if (m) return m[1];
    m = pathname.match(/^\/u\/[^/]+\/c\/([^/?#]+)/);
    if (m) return m[1];
    return null;
  }

  function getCharacterIdFromPath(pathname = location.pathname) {
    let m = pathname.match(/^\/stories\/([^/?#]+)\/episodes\/[^/?#]+/);
    if (m) return m[1];
    m = pathname.match(/^\/characters\/([^/?#]+)\/chats\/[^/?#]+/);
    if (m) return m[1];
    return null;
  }

  function normalizedLibraryLabel(label) {
    return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }


  function libraryDisplayName(lib) {
    return String(lib?.presetName || lib?.label || '캐릭터 설정집').trim() || '캐릭터 설정집';
  }

  function presetScopeIdFromName(name) {
    const normalized = normalizedLibraryLabel(name) || '캐릭터 설정집';
    return `preset:${encodeURIComponent(normalized)}`;
  }

  async function listUsableCharacterLibraries() {
    const all = await getAllCharacterLibraries();
    return all
      .filter(lib => Array.isArray(lib?.characters) && lib.characters.length)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }

  function getCharacterLibraryScopeCandidates(room = state.currentRoom) {
    const raw = [];
    const pathId = getCharacterIdFromPath();
    if (pathId) raw.push(pathId);
    if (room?.characterScopeId) raw.push(room.characterScopeId);
    for (const id of (Array.isArray(room?.characterScopeIds) ? room.characterScopeIds : [])) raw.push(id);
    return [...new Set(raw.filter(Boolean).map(id => `character:${String(id)}`))];
  }

  function getCharacterLibraryScope(room = state.currentRoom) {
    return getCharacterLibraryScopeCandidates(room)[0] || null;
  }

  function getRoomScopeKey(apiChatId, href = location.href) {
    if (!apiChatId) return null;
    try {
      const u = new URL(href, location.origin);
      // Crack이 분기를 query로 표현하는 경우에도 같은 chatRoomId의 데이터가 섞이지 않게 합니다.
      const branchKeys = ['branchId', 'branch', 'forkId', 'threadId', 'conversationId'];
      for (const key of branchKeys) {
        const value = u.searchParams.get(key);
        if (value) return `${apiChatId}::${key}=${value}`;
      }
    } catch (_) {}
    return apiChatId;
  }

  function apiChatIdOf(room) {
    return room?.apiChatId || String(room?.chatId || '').split('::')[0] || null;
  }

  function messageIdOf(m) {
    // chatId는 방 ID일 수 있으므로 메시지 ID의 폴백으로 사용하지 않습니다.
    return m?._id || m?.id || m?.messageId || null;
  }

  function messageRoleOf(m) {
    return m?.role || m?.speaker || '';
  }

  function messageTextOf(m) {
    if (!m) return '';
    if (typeof m.content === 'string') return m.content;
    if (typeof m.message === 'string') return m.message;
    return '';
  }

  function formatCount(n) {
    return Number(n || 0).toLocaleString('ko-KR');
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function debounce(fn, ms = 250) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function normalizeLineBreaks(text) {
    return String(text || '').replace(/\r\n/g, '\n');
  }

  function safeForHtmlComment(text) {
    // 사용자가 붙여넣은 본문 안에 HTML 주석 종료문이 있어도 숨김 블록이 중간에 닫히지 않게 합니다.
    return String(text || '')
      .replace(/<!--/g, '<\u200B!--')
      .replace(/-->/g, '--\u200B>');
  }


  function stripAutomationNoise(text) {
    let src = String(text || '');
    src = stripOurContextBlock(src).text || src;
    // 로어 인젝터의 참고 블록은 자동 캐릭터/과거로그 검색 대상에서 제외합니다.
    src = src
      .replace(/<ooc_lore_context>[\s\S]*?<\/ooc_lore_context>/gi, ' ')
      .replace(/&lt;ooc_lore_context&gt;[\s\S]*?&lt;\/ooc_lore_context&gt;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return src;
  }

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function aliasAppears(text, alias) {
    const hay = String(text || '');
    const needle = String(alias || '').trim();
    if (needle.length < 2) return false;
    if (/[가-힣]/.test(needle)) return hay.includes(needle);
    try {
      return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(needle)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(hay);
    } catch (_) {
      return hay.toLowerCase().includes(needle.toLowerCase());
    }
  }

  function pushNameAndParts(out, value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length < 2) return;
    out.push(name);
    for (const p of name.split(/[\s/·|｜,()【】\[\]{}]+/).map(x => x.trim()).filter(Boolean)) {
      if (p.length >= 2) out.push(p);
    }
  }

  function characterAutomaticTerms(item) {
    const terms = [];
    const title = String(item?.title || '').trim();
    pushNameAndParts(terms, title);

    // 설정팩 안에 정식 표기로 적힌 영문명만 자동 감지어로 승격합니다.
    // 일반 본문 속 영단어를 무차별 수집하지 않아 오탐을 줄입니다.
    const content = normalizeLineBreaks(String(item?.content || ''));
    const lines = content.split('\n').slice(0, 120);
    const labeledName = /(?:^|[\s#*\-])(?:영문명|영어명|영문\s*이름|english\s*name|full\s*name|name)\s*[:=｜]\s*([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})/i;
    for (const line of lines) {
      const m = line.match(labeledName);
      if (m?.[1]) pushNameAndParts(terms, m[1]);
    }
    // 제목에 (Oscar Miller), / Oscar Miller처럼 같이 적힌 경우도 제목 분해로 자동 포함됩니다.
    return [...new Set(terms.map(x => x.trim()).filter(x => x.length >= 2))].sort((a,b) => b.length - a.length);
  }

  function characterDetectionTerms(item) {
    const terms = [...characterAutomaticTerms(item)];
    for (const a of (Array.isArray(item?.aliases) ? item.aliases : [])) {
      const v = String(a || '').trim();
      if (v.length >= 2) terms.push(v);
    }
    return [...new Set(terms)].sort((a,b) => b.length - a.length);
  }

  const LOG_STOPWORDS = new Set([
    '그리고','하지만','그래서','그러나','그런데','지금','현재','오늘','어제','내일','정도','때문','대한','하는','했다','한다','있다','없다','된다','되어','있는','없는','에게','에서','으로','로서','같이','그냥','정말','너무','다시','이미','직접','최신','사실','상태','장면','내용','말함','확정','미확정','자동','금지','유지','사용자','캐릭터','세레나','user','assistant','serena'
  ]);

  function tokenizeRecallText(text) {
    const normalized = String(text || '').toLowerCase();
    const raw = normalized.match(/[\p{L}\p{N}_'-]{2,}/gu) || [];
    return [...new Set(raw.filter(t => t.length >= 2 && !LOG_STOPWORDS.has(t) && !/^\d+$/.test(t)))];
  }

  function simpleHash(value) {
    let h = 2166136261;
    const str = String(value || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function parseDatedLogBlocks(text) {
    const src = normalizeLineBreaks(text);
    // 권장: [2025년 3월 15일-사건명] / 호환: [3월 15일-사건명]
    // 명시적 날짜 미상도 하나의 독립 로그 블록으로 보존합니다.
    // 지원 예: [날짜 미상-사건명] [날짜미정-사건명] [날짜 불명] [날짜 없음-사건명]
    const re = /^[ \t]*\[((?:(\d{4})년[ \t]*)?(\d{1,2})월[ \t]*(\d{1,2})일|날짜[ \t]*(미상|미정|불명|없음))(?:[ \t]*[-–—|｜][ \t]*([^\]]+))?\][ \t]*$/gm;
    const hits = [];
    let m;
    while ((m = re.exec(src))) {
      const isUnknown = !!m[5];
      hits.push({
        index: m.index,
        endTitle: re.lastIndex,
        headingEnd: re.lastIndex,
        fullDate: isUnknown ? `날짜 ${m[5]}` : m[1],
        year: !isUnknown && m[2] ? Number(m[2]) : null,
        month: !isUnknown ? Number(m[3]) : null,
        day: !isUnknown ? Number(m[4]) : null,
        unknownLabel: isUnknown ? `날짜 ${m[5]}` : '',
        isUnknown,
        events: String(m[6] || '').trim(),
        heading: m[0].trim(),
        headingRaw: m[0],
      });
    }
    if (!hits.length) return [];
    return hits.map((h, i) => {
      const end = i + 1 < hits.length ? hits[i + 1].index : src.length;
      const body = src.slice(h.endTitle, end).trim();
      const raw = `${h.heading}${body ? `\n${body}` : ''}`;
      const dateKey = h.isUnknown
        ? `unknown-${i}-${simpleHash(h.heading)}`
        : `${h.year || 'x'}-${String(h.month).padStart(2,'0')}-${String(h.day).padStart(2,'0')}`;
      const key = `${dateKey}-${simpleHash(h.heading)}`;
      const yearPrefix = h.year ? `${h.year}.` : '';
      return {
        ...h,
        key,
        dateKey,
        raw,
        body,
        index: i,
        weekOfMonth: h.isUnknown ? null : Math.min(5, Math.floor((h.day - 1) / 7) + 1),
        titleText: h.isUnknown ? `${h.unknownLabel}${h.events ? ` ${h.events}` : ''}` : `${yearPrefix}${h.month}/${h.day}${h.events ? ` ${h.events}` : ''}`,
        sourceStart: h.index,
        sourceEnd: end,
      };
    });
  }

  // 최신 로그는 저장소에서 뒤에 붙은 순서가 아니라 확정된 실제 날짜를 우선해 고릅니다.
  // 연도가 없는 [M월 D일-...] 블록은 연도를 추측하지 않습니다.
  // 연도 없는 블록만 있는 경우에는 기존 저장소 순서를 유지하고,
  // 연도가 확정된 로그 뒤에 연도 없는 블록이 새로 붙은 경우에만 그 뒤쪽 블록을 안전한 후보로 봅니다.
  function selectRecentLogBlocks(blocks, count) {
    const n = Math.max(0, Number(count) || 0);
    if (!n) return [];
    const dated = (blocks || []).filter(b => b && !b.isUnknown);
    if (!dated.length) return [];

    const withYear = dated.filter(b => Number.isInteger(b.year));
    if (!withYear.length) return dated.slice(-n);

    const knownSorted = [...withYear].sort((a, b) =>
      Number(a.year) - Number(b.year) ||
      Number(a.month) - Number(b.month) ||
      Number(a.day) - Number(b.day) ||
      Number(a.index) - Number(b.index)
    );
    const latestKnown = knownSorted[knownSorted.length - 1];

    // 연도 없는 로그가 '실제 날짜 기준 최신 로그'보다 저장소 뒤쪽에 새로 붙어 있다면
    // 연도를 임의 추정하지 않고 그 뒤쪽 순서를 보조 안전장치로 사용합니다.
    const trailingNoYear = dated.filter(b => b.year == null && Number(b.index) > Number(latestKnown.index));
    if (!trailingNoYear.length) return knownSorted.slice(-n);

    const unknownTail = trailingNoYear.slice(-n);
    const remaining = Math.max(0, n - unknownTail.length);
    return [...(remaining ? knownSorted.slice(-remaining) : []), ...unknownTail];
  }

  function formatNormalizedLogHeading(block, year = null, month = null, day = null) {
    const suffix = block.events ? `-${block.events}` : '';
    if (year && month && day) return `[${Number(year)}년 ${Number(month)}월 ${Number(day)}일${suffix}]`;
    if (!block.isUnknown && month && day) return `[${Number(month)}월 ${Number(day)}일${suffix}]`;
    return `[${block.unknownLabel || '날짜 미상'}${suffix}]`;
  }

  function remapLogSelectionKeysByIndex(room, oldBlocks, newBlocks) {
    const byOldKey = new Map();
    oldBlocks.forEach((b, i) => { if (newBlocks[i]) byOldKey.set(String(b.key), String(newBlocks[i].key)); });
    const valid = new Set(newBlocks.map(b => String(b.key)));
    const remap = arr => (arr || []).map(String).map(k => byOldKey.get(k) || k).filter(k => valid.has(k));
    room.autoLogPinnedKeys = remap(room.autoLogPinnedKeys);
    room.autoLogExcludedKeys = remap(room.autoLogExcludedKeys);
    room.manualLogSelectedKeys = remap(room.manualLogSelectedKeys);
  }

  function duplicateLogDateGroups(room) {
    const log = (room?.slots || []).find(s => s.id === 'logSummary');
    const blocks = parseDatedLogBlocks(log?.content || '');
    const byDate = new Map();
    for (const block of blocks) {
      if (block.isUnknown) continue;
      if (!byDate.has(block.dateKey)) byDate.set(block.dateKey, []);
      byDate.get(block.dateKey).push(block);
    }
    return [...byDate.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([dateKey, arr]) => ({ dateKey, label: arr[0]?.fullDate || dateKey.replace(/^x-/, ''), blocks: arr }));
  }

  function pruneLogSelectionKeys(room, blocks = null) {
    const log = (room?.slots || []).find(s => s.id === 'logSummary');
    const validBlocks = blocks || parseDatedLogBlocks(log?.content || '');
    const valid = new Set(validBlocks.map(b => String(b.key)));
    room.autoLogPinnedKeys = (room.autoLogPinnedKeys || []).map(String).filter(k => valid.has(k));
    room.autoLogExcludedKeys = (room.autoLogExcludedKeys || []).map(String).filter(k => valid.has(k));
    room.manualLogSelectedKeys = (room.manualLogSelectedKeys || []).map(String).filter(k => valid.has(k));
  }

  // 관련로그 검색은 AI 의미추론이 아니라 로컬 키워드 점수화입니다.
  // v0.8.5부터 사건명/장소/물건/희귀 키워드(=비인물 핵심어)를 인물명보다 우선합니다.
  // 인물명은 같은 등장인물이 반복되는 장기방에서 오탐이 많으므로 보조점수로만 사용합니다.
  const LOG_RECALL_DOC_CACHE = new Map();

  function normalizedRecallTerm(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function characterRecallTermSet(room = state.currentRoom) {
    const out = new Set();
    for (const slot of (room?.slots || []).filter(s => s.group === 'character')) {
      for (const term of characterDetectionTerms(slot)) {
        const normalized = normalizedRecallTerm(term);
        if (!normalized) continue;
        out.add(normalized);
        for (const token of tokenizeRecallText(normalized)) out.add(token);
      }
    }
    return out;
  }

  function recallDocForBlock(block) {
    const signature = `${block.key}|${block.raw.length}|${simpleHash(block.raw)}`;
    const cached = LOG_RECALL_DOC_CACHE.get(signature);
    if (cached) return cached;
    const merged = `${block.events} ${block.body}`.toLowerCase();
    const doc = {
      block,
      text: merged,
      tokens: new Set(tokenizeRecallText(merged)),
      titleLower: String(block.events || '').toLowerCase(),
      phrases: String(block.events || '').split(/[·|｜,/]+/).map(x => x.trim().toLowerCase()).filter(x => x.length >= 2),
    };
    // 장기방에서도 캐시가 끝없이 커지지 않게 가볍게 상한을 둡니다.
    if (LOG_RECALL_DOC_CACHE.size > 1800) LOG_RECALL_DOC_CACHE.clear();
    LOG_RECALL_DOC_CACHE.set(signature, doc);
    return doc;
  }

  function scoreRelatedLogBlocks(blocks, contextText, excludedKeys = new Set(), room = state.currentRoom) {
    const query = stripAutomationNoise(contextText);
    if (!query || !blocks.length) return [];
    const queryLower = query.toLowerCase();
    const queryTokens = tokenizeRecallText(query);
    const characterTerms = characterRecallTermSet(room);
    const docs = blocks.map(recallDocForBlock);
    const df = new Map();
    for (const t of queryTokens) {
      let n = 0;
      for (const d of docs) if (d.tokens.has(t) || d.text.includes(t)) n++;
      df.set(t, n);
    }
    const N = Math.max(1, blocks.length);
    const scored = [];
    for (const d of docs) {
      if (excludedKeys.has(d.block.key)) continue;
      let coreScore = 0;
      let characterScore = 0;
      const matchedCoreTokens = [];
      const matchedRareTokens = [];
      const matchedCharacterTerms = [];
      const matchedPhrases = [];

      for (const token of queryTokens) {
        if (!d.text.includes(token)) continue;
        const idf = 1 + Math.log((N + 1) / ((df.get(token) || 0) + 1));
        const inTitle = d.titleLower.includes(token);
        const isCharacter = characterTerms.has(token);
        if (isCharacter) {
          // 인물명은 어디에 있든 보조점수. 여러 명이 반복되어도 총 기여도를 제한합니다.
          characterScore += (inTitle ? 0.95 : 0.28) * idf;
          matchedCharacterTerms.push(token);
        } else {
          // 사건명/장소/물건/특이 단어는 제목 일치에 큰 가중치, 본문 희귀어에도 유효 가중치.
          coreScore += (inTitle ? 6.4 : 1.45) * idf;
          matchedCoreTokens.push(token);
          if (!inTitle && idf >= 1.75) matchedRareTokens.push(token);
        }
      }

      for (const phrase of d.phrases) {
        if (!queryLower.includes(phrase)) continue;
        const phraseTokens = tokenizeRecallText(phrase);
        const isCharacterPhrase = characterTerms.has(phrase) || (phraseTokens.length > 0 && phraseTokens.every(t => characterTerms.has(t)));
        if (isCharacterPhrase) {
          characterScore += 1.6;
          matchedCharacterTerms.push(phrase);
        } else {
          coreScore += 11;
          matchedPhrases.push(phrase);
        }
      }

      // 인물명 여러 개가 겹쳐도 핵심 사건 키워드보다 앞서지 못하도록 보조점수 상한을 둡니다.
      const cappedCharacterScore = Math.min(characterScore, 2.6);
      const score = coreScore + cappedCharacterScore;
      const hasCoreMatch = coreScore >= 1.8;
      const hasCharacterOnlyMatch = !hasCoreMatch && cappedCharacterScore >= 1.8;
      if (hasCoreMatch || hasCharacterOnlyMatch) {
        scored.push({
          block: d.block,
          score,
          coreScore,
          characterScore: cappedCharacterScore,
          coreTier: hasCoreMatch ? 0 : 1,
          matchedTokens:[...new Set([...matchedCoreTokens, ...matchedCharacterTerms])],
          matchedCoreTokens:[...new Set(matchedCoreTokens)],
          matchedRareTokens:[...new Set(matchedRareTokens)],
          matchedCharacterTerms:[...new Set(matchedCharacterTerms)],
          matchedPhrases:[...new Set(matchedPhrases)],
        });
      }
    }
    // 핵심 키워드가 하나라도 맞는 로그를 항상 인물명-only 로그보다 앞세웁니다.
    return scored.sort((a,b) => a.coreTier - b.coreTier || b.score - a.score || b.block.index - a.block.index);
  }

  function relatedLogReason(scored) {
    if (!scored) return '현재 RP와 관련';
    const coreTerms = [...new Set([
      ...(scored.matchedPhrases || []),
      ...(scored.matchedCoreTokens || []),
      ...(scored.matchedRareTokens || []),
    ].filter(Boolean))].slice(0, 4);
    const characterTerms = [...new Set((scored.matchedCharacterTerms || []).filter(Boolean))].slice(0, 3);
    if (coreTerms.length && characterTerms.length) return `핵심 일치: ${coreTerms.join(' · ')} / 인물 보조: ${characterTerms.join(' · ')}`;
    if (coreTerms.length) return `핵심 일치: ${coreTerms.join(' · ')}`;
    if (characterTerms.length) return `인물 보조 일치: ${characterTerms.join(' · ')} (핵심 키워드 없음)`;
    return `관련도 ${Number(scored.score || 0).toFixed(1)}`;
  }

  function logItemPriority(item) {
    if (item?.autoType === 'pinned-log') return 0;
    if (item?.autoType === 'manual-log') return 1;
    if (item?.autoType === 'recent-log') return 2;
    if (item?.autoType === 'related-log') return 3;
    if (item?.autoType === 'legacy-log') return 4;
    return 9;
  }

  function makeLogRecallItem(block, slot, autoType, prefix, reason, extra = {}) {
    return {
      slotId: `auto-log:${block.key}`,
      sourceSlotId: 'logSummary',
      autoType,
      sourceKey: block.key,
      title: `${prefix} ${block.titleText}`,
      group: 'log-auto',
      content: block.raw,
      totalTurns: normalizeRetentionTurns(slot.retentionTurns),
      usedTurns: 0,
      recallReason: reason,
      recallScore: extra.score ?? null,
      matchedTerms: extra.matchedTerms || [],
      logIndex: block.index,
      logPriority: logItemPriority({ autoType }),
    };
  }

  function collectLogRecallCandidates(room, contextText = '') {
    const slot = (room.slots || []).find(s => s.id === 'logSummary');
    if (!slot?.enabled || !String(slot.content || '').trim()) return [];
    const blocks = parseDatedLogBlocks(slot.content);
    if (!blocks.length) {
      const whole = String(slot.content || '').trim();
      if (whole.length <= APP.legacyWholeLogFallbackMax) {
        return [{
          slotId: slot.id, sourceSlotId: 'logSummary', autoType:'legacy-log', title:`${slot.title} (날짜블록 미감지)`, group:'log-auto', content:whole,
          totalTurns:normalizeRetentionTurns(slot.retentionTurns), usedTurns:0, recallReason:'날짜 블록 미감지 · 소형 로그 호환 주입', logPriority:4, logIndex:0,
        }];
      }
      return [];
    }

    const excludedKeys = new Set((room.autoLogExcludedKeys || []).map(String));
    const pinnedKeys = new Set((room.autoLogPinnedKeys || []).map(String));
    const manualKeys = new Set((room.manualLogSelectedKeys || []).map(String));
    const eligibleAuto = blocks.filter(b => !excludedKeys.has(b.key));
    const byKey = new Map();

    const put = (item) => {
      const prev = byKey.get(item.sourceKey || item.slotId);
      if (!prev || logItemPriority(item) < logItemPriority(prev)) byKey.set(item.sourceKey || item.slotId, item);
    };

    for (const b of blocks.filter(b => pinnedKeys.has(b.key))) put(makeLogRecallItem(b, slot, 'pinned-log', '고정로그', '사용자 고정'));
    for (const b of blocks.filter(b => manualKeys.has(b.key))) put(makeLogRecallItem(b, slot, 'manual-log', '직접로그', '사용자 직접 선택'));

    if (room.autoLogRecallEnabled) {
      const occupied = new Set([...pinnedKeys, ...manualKeys]);
      const recentCount = Math.max(1, Math.min(2, Number(room.autoLogRecentBlocks) || APP.defaultRecentLogBlocks));
      const recent = selectRecentLogBlocks(eligibleAuto.filter(b => !occupied.has(b.key)), recentCount);
      for (const b of recent) put(makeLogRecallItem(b, slot, 'recent-log', '최근로그', '최신 날짜 기본 유지'));
      const skip = new Set([...excludedKeys, ...occupied, ...recent.map(b => b.key)]);
      const relatedCount = Math.max(1, Math.min(4, Number(room.autoLogRelatedBlocks) || APP.defaultRelatedLogBlocks));
      const relatedScored = scoreRelatedLogBlocks(eligibleAuto, contextText, skip, room).slice(0, relatedCount);
      for (const scored of relatedScored) {
        put(makeLogRecallItem(scored.block, slot, 'related-log', '관련로그', relatedLogReason(scored), {
          score: scored.score,
          matchedTerms:[...(scored.matchedPhrases || []), ...(scored.matchedCoreTokens || []), ...(scored.matchedCharacterTerms || [])],
        }));
      }
    }
    return [...byKey.values()];
  }

  function contextBudgetForPreview(room) {
    return Math.min(Number(room.maxChars) || APP.defaultMaxChars, APP.safeChars);
  }

  function contextBudgetForCarrier(room, originalChars = 0) {
    return Math.max(0, (Number(room.maxChars) || APP.defaultMaxChars) - Number(originalChars || 0) - 2);
  }

  function fitLogItemsToBudget(room, baseItems, logItems, contextBudget = null) {
    const limit = Number.isFinite(Number(contextBudget)) ? Number(contextBudget) : contextBudgetForPreview(room);
    const sorted = [...(logItems || [])].sort((a,b) => {
      const pa = logItemPriority(a), pb = logItemPriority(b);
      if (pa !== pb) return pa - pb;
      if (pa === 3) return Number(b.recallScore || 0) - Number(a.recallScore || 0);
      return Number(a.logIndex || 0) - Number(b.logIndex || 0);
    });
    const chosen = [];
    const omitted = [];
    for (const item of sorted) {
      const trial = [...baseItems, ...chosen, item];
      if (buildContextBlockFromItems(trial).length <= limit) chosen.push(item);
      else omitted.push(item);
    }
    // 실제 프롬프트에는 사건 시간순으로 배치해 읽기 흐름을 보존합니다.
    chosen.sort((a,b) => Number(a.logIndex || 0) - Number(b.logIndex || 0));
    room._logBudgetInfo = {
      limit,
      candidates: sorted.length,
      included: chosen.length,
      omitted: omitted.length,
      omittedTitles: omitted.slice(0, 6).map(x => x.title),
    };
    return chosen;
  }

  function logRecallItems(room, contextText = '', baseItems = [], contextBudget = null) {
    const candidates = collectLogRecallCandidates(room, contextText);
    return fitLogItemsToBudget(room, baseItems, candidates, contextBudget);
  }

  function shortId(id) {
    const s = String(id || '');
    return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
  }

  function normalizeRetentionTurns(value) {
    const n = Number(value);
    return APP.allowedRetentionTurns.includes(n) ? n : APP.defaultRetentionTurns;
  }

  function retentionLabel(totalTurns) {
    return Number(totalTurns) === 0 ? '직접 해제 전까지' : `${Number(totalTurns)}턴`;
  }

  function remainingLabelForItem(item) {
    const total = Number(item?.totalTurns || 0);
    const used = Number(item?.usedTurns || 0);
    if (total === 0) return '직접 해제';
    return `${Math.max(0, total - used)}턴`;
  }

  function pendingProgressText(p) {
    if (!p) return '';
    const items = Array.isArray(p.items) ? p.items : [];
    if (!items.length) {
      const used = Number(p.usedTurns || 0), total = Number(p.totalTurns || 0);
      return total === 0 ? `${formatCount(used)}턴 사용 · 직접 해제 전까지 유지` : `${formatCount(used)}/${formatCount(total)}턴 사용 · 남은 ${formatCount(Math.max(0,total-used))}턴`;
    }
    const active = items.filter(i => Number(i.totalTurns || 0) === 0 || Number(i.usedTurns || 0) < Number(i.totalTurns || 0));
    const persistentCount = active.filter(i => Number(i.totalTurns || 0) === 0).length;
    const preview = active.slice(0, 4).map(i => `${i.title}: ${remainingLabelForItem(i)}`).join(' · ');
    return `${active.length}개 항목 유지 중${persistentCount ? ` · 직접 해제 ${persistentCount}개` : ''}${preview ? ` · ${preview}` : ''}${active.length > 4 ? ' · …' : ''}`;
  }

  function notifyInjectionEnded(room, reason = 'completed', detail = '') {
    if (!room || room.chatId !== state.currentChatId) return;
    const reasonText = reason === 'manual' ? '사용자가 직접 해제함'
      : reason === 'error' ? '자동 유지가 중단됨'
      : reason === 'empty' ? '활성 항목이 없어 종료됨'
      : '모든 유한 유지턴이 끝남';
    const suffix = detail ? ` · ${detail}` : '';
    notify(`🪽위시 RP Manager 주입 종료 · ${reasonText}${suffix}`, reason === 'error' ? 'error' : 'success', 8000);
  }

  function loadModalPosition() {
    try {
      const raw = localStorage.getItem(APP.modalPosKey);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return Number.isFinite(p?.left) && Number.isFinite(p?.top) ? p : null;
    } catch (_) { return null; }
  }

  function saveModalPosition(left, top) {
    const p = { left: Math.round(left), top: Math.round(top) };
    state.modalPos = p;
    try { localStorage.setItem(APP.modalPosKey, JSON.stringify(p)); } catch (_) {}
  }

  function notify(text, type = 'info', timeout = 3500) {
    let wrap = document.getElementById('rpcm-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'rpcm-toast-wrap';
      document.body.appendChild(wrap);
    }
    const node = document.createElement('div');
    node.className = `rpcm-toast ${type}`;
    node.textContent = text;
    wrap.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 250);
    }, timeout);
  }

  function openCharacterSelectionDialog({ title, description = '', items = [], confirmText = '확인', preserveOption = false, preserveDefault = true }) {
    return new Promise(resolve => {
      const old = document.getElementById('rpcm-lib-dialog-backdrop');
      if (old) old.remove();
      const backdrop = document.createElement('div');
      backdrop.id = 'rpcm-lib-dialog-backdrop';
      const safeItems = items.map((item, index) => ({ item, index }));
      backdrop.innerHTML = `
        <div class="rpcm-lib-dialog" role="dialog" aria-modal="true">
          <div class="rpcm-lib-dialog-head"><div><div class="rpcm-lib-dialog-title">${esc(title)}</div>${description ? `<div class="rpcm-lib-dialog-desc">${esc(description)}</div>` : ''}</div><button type="button" class="rpcm-lib-close">✕</button></div>
          <div class="rpcm-lib-toolbar"><button type="button" class="rpcm-lib-small" data-act="all">전체 선택</button><button type="button" class="rpcm-lib-small" data-act="none">전체 해제</button><span class="rpcm-lib-selected">${safeItems.length}개 선택</span></div>
          <div class="rpcm-lib-list">${safeItems.map(({item,index}) => `<label class="rpcm-lib-row"><input type="checkbox" data-lib-index="${index}" checked><span><strong>${esc(item.title || '캐릭터')}</strong><small>${formatCount(String(item.content || '').length)}자 · ${retentionLabel(item.retentionTurns)}</small></span></label>`).join('')}</div>
          ${preserveOption ? `<label class="rpcm-lib-preserve"><input type="checkbox" id="rpcm-lib-preserve" ${preserveDefault ? 'checked' : ''}><span>설정집에 이미 있는 미선택 캐릭터는 그대로 유지</span></label>` : ''}
          <div class="rpcm-lib-dialog-actions"><button type="button" class="rpcm-btn secondary" data-act="cancel">취소</button><button type="button" class="rpcm-btn primary" data-act="confirm">${esc(confirmText)}</button></div>
        </div>`;
      document.body.appendChild(backdrop);
      const selectedEl = backdrop.querySelector('.rpcm-lib-selected');
      const cbs = () => [...backdrop.querySelectorAll('[data-lib-index]')];
      const refresh = () => { if (selectedEl) selectedEl.textContent = `${cbs().filter(cb => cb.checked).length}개 선택`; };
      cbs().forEach(cb => cb.onchange = refresh);
      const finish = value => { backdrop.remove(); resolve(value); };
      backdrop.querySelector('.rpcm-lib-close').onclick = () => finish(null);
      backdrop.querySelector('[data-act="cancel"]').onclick = () => finish(null);
      backdrop.querySelector('[data-act="all"]').onclick = () => { cbs().forEach(cb => cb.checked = true); refresh(); };
      backdrop.querySelector('[data-act="none"]').onclick = () => { cbs().forEach(cb => cb.checked = false); refresh(); };
      backdrop.querySelector('[data-act="confirm"]').onclick = () => {
        const indexes = cbs().filter(cb => cb.checked).map(cb => Number(cb.dataset.libIndex));
        if (!indexes.length) { notify('하나 이상 선택해 주세요.', 'warn'); return; }
        const preserve = preserveOption ? !!backdrop.querySelector('#rpcm-lib-preserve')?.checked : false;
        finish({ items: indexes.map(i => items[i]).filter(Boolean), preserve });
      };
      backdrop.onclick = e => { if (e.target === backdrop) finish(null); };
    });
  }


  function openLibraryPickerDialog(libraries, { title = '불러올 설정집 선택', confirmText = '이 설정집 선택' } = {}) {
    return new Promise(resolve => {
      const old = document.getElementById('rpcm-lib-dialog-backdrop');
      if (old) old.remove();
      const backdrop = document.createElement('div');
      backdrop.id = 'rpcm-lib-dialog-backdrop';
      const safe = (libraries || []).map((lib, index) => ({ lib, index }));
      backdrop.innerHTML = `
        <div class="rpcm-lib-dialog" role="dialog" aria-modal="true">
          <div class="rpcm-lib-dialog-head"><div><div class="rpcm-lib-dialog-title">${esc(title)}</div><div class="rpcm-lib-dialog-desc">저장 위치와 관계없이 모든 🪽위시 RP Manager 설정집에서 선택합니다. 선택한 설정집의 이름도 여기서 수정할 수 있습니다.</div></div><button type="button" class="rpcm-lib-close">✕</button></div>
          <div class="rpcm-lib-list">${safe.map(({lib,index}) => {
            const nm = libraryDisplayName(lib);
            const count = Array.isArray(lib.characters) ? lib.characters.length : 0;
            const source = lib.sourceLabel || lib.sourceLabels?.[0] || '';
            return `<div class="rpcm-lib-row rpcm-library-row"><label class="rpcm-lib-row-main"><input type="radio" name="rpcm-library-choice" data-lib-index="${index}" ${index === 0 ? 'checked' : ''}><span><strong data-lib-name="${index}">${esc(nm)}</strong><small>${count}명${source ? ` · 저장 출처 ${esc(source)}` : ''}</small></span></label><button type="button" class="rpcm-lib-rename-icon" data-rename-index="${index}" title="설정집 이름 수정" aria-label="${esc(nm)} 이름 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div>`;
          }).join('')}</div>
          <div class="rpcm-lib-dialog-actions"><button type="button" class="rpcm-btn secondary" data-act="cancel">취소</button><button type="button" class="rpcm-btn primary" data-act="confirm">${esc(confirmText)}</button></div>
        </div>`;
      document.body.appendChild(backdrop);
      const finish = value => { backdrop.remove(); resolve(value); };
      backdrop.querySelector('.rpcm-lib-close').onclick = () => finish(null);
      backdrop.querySelector('[data-act="cancel"]').onclick = () => finish(null);
      async function renameLibraryAtIndex(index) {
        const lib = libraries[index];
        if (!lib) return;
        const before = libraryDisplayName(lib);
        const entered = prompt('설정집 새 이름을 입력해 주세요.', before);
        if (entered === null) return;
        const nextName = String(entered || '').trim();
        if (!nextName) { notify('설정집 이름을 입력해 주세요.', 'warn'); return; }
        if (nextName === before) return;
        const nextKey = normalizedLibraryLabel(nextName);
        const duplicated = libraries.some((other, otherIndex) => otherIndex !== index && normalizedLibraryLabel(libraryDisplayName(other)) === nextKey);
        if (duplicated) { notify('같은 이름의 설정집이 이미 있습니다.', 'warn', 4500); return; }
        try {
          const updated = { ...lib, presetName: nextName, label: nextName };
          await saveCharacterLibrary(updated);
          libraries[index] = updated;
          const nameEl = backdrop.querySelector(`[data-lib-name="${index}"]`);
          if (nameEl) nameEl.textContent = nextName;
          const renameBtn = backdrop.querySelector(`[data-rename-index="${index}"]`);
          if (renameBtn) {
            renameBtn.title = '설정집 이름 수정';
            renameBtn.setAttribute('aria-label', `${nextName} 이름 수정`);
          }
          const autoOpt = document.querySelector(`#rpcm-auto-char-library option[value="${CSS.escape(String(updated.scopeId || ''))}"]`);
          if (autoOpt) autoOpt.textContent = `${nextName} (${Array.isArray(updated.characters) ? updated.characters.length : 0}명)`;
          notify(`설정집 이름을 ‘${nextName}’(으)로 수정했습니다.`, 'success', 4200);
        } catch (e) {
          notify(`설정집 이름 수정 실패: ${e.message}`, 'error', 5500);
        }
      }
      backdrop.querySelectorAll('[data-rename-index]').forEach(btn => {
        btn.onclick = async e => {
          e.preventDefault();
          e.stopPropagation();
          const index = Number(btn.dataset.renameIndex);
          const radio = backdrop.querySelector(`input[name="rpcm-library-choice"][data-lib-index="${index}"]`);
          if (radio) radio.checked = true;
          await renameLibraryAtIndex(index);
        };
      });
      backdrop.querySelector('[data-act="confirm"]').onclick = () => {
        const checked = backdrop.querySelector('input[name="rpcm-library-choice"]:checked');
        if (!checked) { notify('설정집을 하나 선택해 주세요.', 'warn'); return; }
        finish(libraries[Number(checked.dataset.libIndex)] || null);
      };
      backdrop.onclick = e => { if (e.target === backdrop) finish(null); };
    });
  }

  function downloadText(text, filename, mime = 'application/json') {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openLogDateNormalizerDialog(room) {
    return new Promise(resolve => {
      const log = (room.slots || []).find(s => s.id === 'logSummary');
      const originalText = String(log?.content || '');
      const blocks = parseDatedLogBlocks(originalText);
      if (!blocks.length) {
        notify('수정할 날짜 로그 블록을 찾지 못했습니다.', 'warn', 4200);
        resolve(false);
        return;
      }

      const dated = blocks.filter(b => !b.isUnknown);
      const unknown = blocks.filter(b => b.isUnknown);
      const old = document.getElementById('rpcm-log-dialog-backdrop');
      if (old) old.remove();
      const backdrop = document.createElement('div');
      backdrop.id = 'rpcm-log-dialog-backdrop';

      const datedHtml = dated.length ? `
        <details class="rpcm-log-year" open>
          <summary><strong>날짜가 있는 로그</strong><span>${dated.length}개</span></summary>
          <div class="rpcm-log-help">이미 연도를 붙인 로그도 언제든 다시 수정할 수 있습니다. 여러 항목을 체크한 뒤 연도만 한꺼번에 바꾸거나, 각 행에서 연도·월·일을 직접 고칠 수 있습니다. 연도 칸을 비우면 다시 [M월 D일-...] 형식으로 되돌립니다.</div>
          <div class="rpcm-log-groupbar">
            <button type="button" class="rpcm-lib-small" id="rpcm-date-select-all">전체 선택</button>
            <button type="button" class="rpcm-lib-small" id="rpcm-date-select-none">전체 해제</button>
            <label>선택 연도 <input id="rpcm-date-bulk-year" type="number" min="1000" max="9999" step="1" placeholder="2025" style="width:82px"></label>
            <button type="button" class="rpcm-lib-small" id="rpcm-date-apply-year">선택에 연도 적용</button>
            <button type="button" class="rpcm-lib-small" id="rpcm-date-clear-year">선택 연도 비우기</button>
          </div>
          ${dated.map(b => `<div class="rpcm-log-row rpcm-date-row" data-log-index="${b.index}"><div class="rpcm-log-row-head"><label style="display:flex;align-items:center;gap:7px;flex:1;min-width:0"><input type="checkbox" class="rpcm-date-select"><strong>${esc(b.titleText)}</strong></label><div style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap"><input class="rpcm-date-year" type="number" min="1000" max="9999" step="1" value="${b.year || ''}" placeholder="연도" style="width:76px" title="비우면 연도 없는 날짜로 변경"><span style="font-size:10px;color:#777">년</span><input class="rpcm-date-month" type="number" min="1" max="12" step="1" value="${b.month}" style="width:48px"><span style="font-size:10px;color:#777">월</span><input class="rpcm-date-day" type="number" min="1" max="31" step="1" value="${b.day}" style="width:48px"><span style="font-size:10px;color:#777">일</span></div></div><div class="rpcm-log-row-reason">원문: ${esc(b.heading)}</div></div>`).join('')}
        </details>` : '';

      const unknownHtml = unknown.length ? `
        <details class="rpcm-log-year" open>
          <summary><strong>날짜 미상</strong><span>${unknown.length}개</span></summary>
          <div class="rpcm-log-help">날짜 미상은 정상적인 로그 상태로 그대로 둘 수 있습니다. 실제 날짜를 알게 된 항목만 오른쪽에 날짜를 지정하세요. 비워두면 계속 ‘날짜 미상’으로 유지됩니다.</div>
          ${unknown.map(b => `<div class="rpcm-log-row rpcm-date-unknown-row" data-log-index="${b.index}"><div class="rpcm-log-row-head"><strong>${esc(b.titleText)}</strong><input class="rpcm-date-full" type="date" title="비워두면 날짜 미상 유지" style="width:145px"></div><div class="rpcm-log-row-reason">원문: ${esc(b.heading)}</div></div>`).join('')}
        </details>` : '';

      backdrop.innerHTML = `
        <div class="rpcm-log-dialog" role="dialog" aria-modal="true">
          <div class="rpcm-lib-dialog-head"><div><div class="rpcm-lib-dialog-title">날짜 / 연도 수정</div><div class="rpcm-lib-dialog-desc">연도 누락 보정뿐 아니라 이미 정리한 날짜도 언제든 다시 수정합니다. 로그 본문은 건드리지 않고 [날짜-사건명] 제목만 변경합니다.</div></div><button type="button" class="rpcm-lib-close">✕</button></div>
          <div class="rpcm-log-list">${datedHtml}${unknownHtml}</div>
          <div class="rpcm-lib-dialog-actions"><div class="rpcm-spacer"></div><button type="button" class="rpcm-btn secondary" data-act="cancel">취소</button><button type="button" class="rpcm-btn primary" data-act="confirm">날짜 수정 적용</button></div>
        </div>`;
      document.body.appendChild(backdrop);

      const finish = value => { backdrop.remove(); resolve(value); };
      backdrop.querySelector('.rpcm-lib-close').onclick = () => finish(false);
      backdrop.querySelector('[data-act="cancel"]').onclick = () => finish(false);
      backdrop.onclick = e => { if (e.target === backdrop) finish(false); };

      const allBtn = backdrop.querySelector('#rpcm-date-select-all');
      const noneBtn = backdrop.querySelector('#rpcm-date-select-none');
      const applyYearBtn = backdrop.querySelector('#rpcm-date-apply-year');
      const clearYearBtn = backdrop.querySelector('#rpcm-date-clear-year');
      if (allBtn) allBtn.onclick = () => backdrop.querySelectorAll('.rpcm-date-select').forEach(cb => { cb.checked = true; });
      if (noneBtn) noneBtn.onclick = () => backdrop.querySelectorAll('.rpcm-date-select').forEach(cb => { cb.checked = false; });
      if (applyYearBtn) applyYearBtn.onclick = () => {
        const year = Number(backdrop.querySelector('#rpcm-date-bulk-year')?.value || 0);
        if (!Number.isInteger(year) || year < 1000 || year > 9999) { notify('적용할 연도를 4자리 숫자로 입력해 주세요.', 'warn', 3800); return; }
        const selected = [...backdrop.querySelectorAll('.rpcm-date-row')].filter(row => row.querySelector('.rpcm-date-select')?.checked);
        if (!selected.length) { notify('연도를 적용할 날짜를 먼저 선택해 주세요.', 'warn', 3800); return; }
        selected.forEach(row => { const input = row.querySelector('.rpcm-date-year'); if (input) input.value = String(year); });
      };
      if (clearYearBtn) clearYearBtn.onclick = () => {
        const selected = [...backdrop.querySelectorAll('.rpcm-date-row')].filter(row => row.querySelector('.rpcm-date-select')?.checked);
        if (!selected.length) { notify('연도를 비울 날짜를 먼저 선택해 주세요.', 'warn', 3800); return; }
        selected.forEach(row => { const input = row.querySelector('.rpcm-date-year'); if (input) input.value = ''; });
      };

      backdrop.querySelector('[data-act="confirm"]').onclick = () => {
        const replacements = [];
        let invalidMessage = '';

        backdrop.querySelectorAll('.rpcm-date-row').forEach(row => {
          if (invalidMessage) return;
          const idx = Number(row.dataset.logIndex);
          const block = blocks[idx];
          if (!block) return;
          const rawYear = String(row.querySelector('.rpcm-date-year')?.value || '').trim();
          const rawMonth = String(row.querySelector('.rpcm-date-month')?.value || '').trim();
          const rawDay = String(row.querySelector('.rpcm-date-day')?.value || '').trim();
          const year = rawYear ? Number(rawYear) : null;
          const month = Number(rawMonth);
          const day = Number(rawDay);
          if (year != null && (!Number.isInteger(year) || year < 1000 || year > 9999)) { invalidMessage = `${block.titleText}: 연도를 4자리 숫자로 입력해 주세요.`; return; }
          if (!Number.isInteger(month) || month < 1 || month > 12) { invalidMessage = `${block.titleText}: 월은 1~12 사이여야 합니다.`; return; }
          const checkYear = year || 2000;
          const maxDay = new Date(checkYear, month, 0).getDate();
          if (!Number.isInteger(day) || day < 1 || day > maxDay) { invalidMessage = `${block.titleText}: ${month}월의 날짜가 올바르지 않습니다.`; return; }
          const changed = (year || null) !== (block.year || null) || month !== block.month || day !== block.day;
          if (!changed) return;
          replacements.push({ start:block.sourceStart, end:block.headingEnd, text:formatNormalizedLogHeading(block, year, month, day) });
        });

        if (invalidMessage) { notify(invalidMessage, 'warn', 5200); return; }

        backdrop.querySelectorAll('.rpcm-date-unknown-row').forEach(row => {
          const idx = Number(row.dataset.logIndex);
          const block = blocks[idx];
          const value = String(row.querySelector('.rpcm-date-full')?.value || '').trim();
          if (!block || !value) return; // blank = 날짜 미상 유지
          const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!m) return;
          replacements.push({ start:block.sourceStart, end:block.headingEnd, text:formatNormalizedLogHeading(block, Number(m[1]), Number(m[2]), Number(m[3])) });
        });

        if (!replacements.length) { notify('변경된 날짜가 없습니다.', 'info', 3200); return; }
        let next = originalText;
        replacements.sort((a,b) => b.start - a.start).forEach(r => { next = next.slice(0, r.start) + r.text + next.slice(r.end); });
        const newBlocks = parseDatedLogBlocks(next);
        if (newBlocks.length !== blocks.length) { notify('날짜 수정 후 블록 수가 달라져 적용을 중단했습니다.', 'error', 6200); return; }
        log.content = next;
        remapLogSelectionKeysByIndex(room, blocks, newBlocks);
        finish(true);
      };
    });
  }

  function manualLogSelectionStats(room) {
    const log = (room.slots || []).find(s => s.id === 'logSummary');
    const blocks = parseDatedLogBlocks(log?.content || '');
    const selected = new Set((room.manualLogSelectedKeys || []).map(String));
    const items = blocks.filter(b => selected.has(String(b.key)));
    return {
      count: items.length,
      chars: items.reduce((n, b) => n + String(b.raw || '').length, 0),
      blocks: items,
    };
  }

  function openLogRecallManagerDialog(room) {
    return new Promise(resolve => {
      const log = (room.slots || []).find(s => s.id === 'logSummary');
      const blocks = parseDatedLogBlocks(log?.content || '');
      if (!blocks.length) { notify('로그요약에서 날짜 블록을 찾지 못했습니다. [YYYY년 M월 D일-사건명] 형식을 권장합니다.', 'warn', 6500); resolve(false); return; }
      const old = document.getElementById('rpcm-log-dialog-backdrop');
      if (old) old.remove();
      const backdrop = document.createElement('div');
      backdrop.id = 'rpcm-log-dialog-backdrop';
      const pinned = new Set((room.autoLogPinnedKeys || []).map(String));
      const excluded = new Set((room.autoLogExcludedKeys || []).map(String));
      const manual = new Set((room.manualLogSelectedKeys || []).map(String));
      const contextText = room.autoRecallContextText || '';
      const scored = new Map(scoreRelatedLogBlocks(blocks, contextText, new Set(), room).map(x => [x.block.key, x]));

      const grouped = new Map();
      const unknownBlocks = blocks.filter(b => b.isUnknown);
      for (const b of blocks.filter(b => !b.isUnknown)) {
        const y = b.year == null ? '연도 미상' : `${b.year}년`;
        if (!grouped.has(y)) grouped.set(y, new Map());
        const months = grouped.get(y);
        const m = `${b.month}월`;
        if (!months.has(m)) months.set(m, []);
        months.get(m).push(b);
      }
      const yearEntries = [...grouped.entries()];
      const latestYearIndex = yearEntries.length - 1;
      const totalChars = blocks.reduce((n,b) => n + b.raw.length, 0);

      const datedRowsHtml = yearEntries.map(([yearLabel, months], yi) => {
        const monthEntries = [...months.entries()];
        return `<details class="rpcm-log-year" ${yi === latestYearIndex ? 'open' : ''}><summary><strong>${esc(yearLabel)}</strong><span>${[...months.values()].reduce((n,a)=>n+a.length,0)}개 날짜</span></summary>${monthEntries.map(([monthLabel, monthBlocks], mi) => {
          const monthKey = `y${yi}-m${mi}`;
          const weekGroups = [1,2,3,4,5].map(w => ({ w, arr:monthBlocks.filter(b => b.weekOfMonth === w) })).filter(x => x.arr.length);
          return `<details class="rpcm-log-month" ${yi === latestYearIndex && mi === monthEntries.length - 1 ? 'open' : ''}><summary><strong>${esc(monthLabel)}</strong><span>${monthBlocks.length}개 · ${formatCount(monthBlocks.reduce((n,b)=>n+b.raw.length,0))}자</span></summary>
            <div class="rpcm-log-groupbar"><label><input type="checkbox" class="rpcm-log-group-select" data-keys="${esc(monthBlocks.map(b=>b.key).join('|'))}"> 월 전체 직접 선택</label>${weekGroups.map(g => `<label><input type="checkbox" class="rpcm-log-group-select" data-keys="${esc(g.arr.map(b=>b.key).join('|'))}"> ${g.w}주 (${g.arr.length})</label>`).join('')}</div>
            ${monthBlocks.map(b => {
              const sc = scored.get(b.key);
              const reason = sc ? relatedLogReason(sc) : '현재 문맥 일치 없음';
              return `<div class="rpcm-log-row" data-log-key="${esc(b.key)}"><div class="rpcm-log-row-head"><strong>${esc(b.titleText)}</strong><span>${formatCount(b.raw.length)}자</span></div><div class="rpcm-log-row-reason">${esc(reason)}${sc ? ` · 점수 ${Number(sc.score).toFixed(1)}` : ''}</div><div class="rpcm-log-row-controls"><label><input type="checkbox" class="rpcm-log-manual" ${manual.has(b.key) ? 'checked' : ''}> 직접 선택</label><label><input type="checkbox" class="rpcm-log-pin" ${pinned.has(b.key) ? 'checked' : ''}> 📌 항상 호출</label><label><input type="checkbox" class="rpcm-log-exclude" ${excluded.has(b.key) ? 'checked' : ''}> 🚫 자동 제외</label><button type="button" class="rpcm-lib-small rpcm-log-toggle">내용 보기</button></div><pre class="rpcm-log-content" hidden>${esc(b.raw)}</pre></div>`;
            }).join('')}</details>`;
        }).join('')}</details>`;
      }).join('');
      const unknownRowsHtml = unknownBlocks.length ? `<details class="rpcm-log-year" open><summary><strong>날짜 미상</strong><span>${unknownBlocks.length}개 블록</span></summary><div class="rpcm-log-help">날짜 미상 로그는 최신 날짜 계산에서는 제외되지만 관련도 검색·직접 선택·📌 항상 호출에는 사용할 수 있습니다. 실제 날짜를 알게 되면 ‘날짜 정리’에서 지정할 수 있습니다.</div>${unknownBlocks.map(b => { const sc = scored.get(b.key); const reason = sc ? relatedLogReason(sc) : '현재 문맥 일치 없음'; return `<div class="rpcm-log-row" data-log-key="${esc(b.key)}"><div class="rpcm-log-row-head"><strong>${esc(b.titleText)}</strong><span>${formatCount(b.raw.length)}자</span></div><div class="rpcm-log-row-reason">${esc(reason)}${sc ? ` · 점수 ${Number(sc.score).toFixed(1)}` : ''}</div><div class="rpcm-log-row-controls"><label><input type="checkbox" class="rpcm-log-manual" ${manual.has(b.key) ? 'checked' : ''}> 직접 선택</label><label><input type="checkbox" class="rpcm-log-pin" ${pinned.has(b.key) ? 'checked' : ''}> 📌 항상 호출</label><label><input type="checkbox" class="rpcm-log-exclude" ${excluded.has(b.key) ? 'checked' : ''}> 🚫 자동 제외</label><button type="button" class="rpcm-lib-small rpcm-log-toggle">내용 보기</button></div><pre class="rpcm-log-content" hidden>${esc(b.raw)}</pre></div>`; }).join('')}</details>` : '';
      const rowsHtml = `${datedRowsHtml}${unknownRowsHtml}`;

      backdrop.innerHTML = `
        <div class="rpcm-log-dialog" role="dialog" aria-modal="true">
          <div class="rpcm-lib-dialog-head"><div><div class="rpcm-lib-dialog-title">날짜별 로그 저장소 · 주입 선택</div><div class="rpcm-lib-dialog-desc">원본 로그 ${blocks.length}개 블록 · ${formatCount(totalChars)}자${unknownBlocks.length ? ` · 날짜 미상 ${unknownBlocks.length}개` : ''}. 이 창 하나에서 연도→월→날짜별 로그를 보면서 직접 선택·📌항상 호출·🚫자동 제외를 모두 관리합니다.</div></div><button type="button" class="rpcm-lib-close">✕</button></div>
          <div class="rpcm-log-help"><b>직접 선택</b>=선택한 날짜를 다음 주입 후보에 강제 포함 · <b>📌 항상 호출</b>=항상 우선 포함 · <b>🚫 자동 제외</b>=최신/관련 자동호출에서만 제외(직접 선택은 가능) · 자동호출 ON이면 최신 1~2개 + 관련 과거 로그를 추가로 고릅니다.</div>
          <div class="rpcm-log-help" id="rpcm-log-manager-summary"></div>
          <div class="rpcm-log-list">${rowsHtml}</div>
          <div class="rpcm-lib-dialog-actions"><button type="button" class="rpcm-btn secondary" id="rpcm-log-clear-manual">직접 선택 전체 해제</button><div class="rpcm-spacer"></div><button type="button" class="rpcm-btn secondary" data-act="cancel">취소</button><button type="button" class="rpcm-btn primary" data-act="confirm">적용</button></div>
        </div>`;
      document.body.appendChild(backdrop);

      const finish = value => { backdrop.remove(); resolve(value); };
      const managerSummary = backdrop.querySelector('#rpcm-log-manager-summary');
      const updateGroupState = () => {
        backdrop.querySelectorAll('.rpcm-log-group-select').forEach(group => {
          const keys = String(group.dataset.keys || '').split('|').filter(Boolean);
          const states = keys.map(k => !!backdrop.querySelector(`.rpcm-log-row[data-log-key="${CSS.escape(k)}"] .rpcm-log-manual`)?.checked);
          group.checked = states.length > 0 && states.every(Boolean);
          group.indeterminate = states.some(Boolean) && !states.every(Boolean);
        });
        const selectedRows = [...backdrop.querySelectorAll('.rpcm-log-row')].filter(row => row.querySelector('.rpcm-log-manual')?.checked);
        const selectedChars = selectedRows.reduce((n, row) => {
          const key = String(row.dataset.logKey || '');
          const block = blocks.find(b => String(b.key) === key);
          return n + String(block?.raw || '').length;
        }, 0);
        if (managerSummary) managerSummary.innerHTML = `<b>현재 직접 선택 ${selectedRows.length}개</b> · ${formatCount(selectedChars)}자 · 자동 호출을 꺼도 직접 선택 날짜는 주입 후보에 유지됩니다.`;
      };
      backdrop.querySelector('.rpcm-lib-close').onclick = () => finish(false);
      backdrop.querySelector('[data-act="cancel"]').onclick = () => finish(false);
      backdrop.querySelectorAll('.rpcm-log-toggle').forEach(btn => btn.onclick = () => {
        const pre = btn.closest('.rpcm-log-row')?.querySelector('.rpcm-log-content');
        if (!pre) return;
        pre.hidden = !pre.hidden;
        btn.textContent = pre.hidden ? '내용 보기' : '내용 닫기';
      });
      backdrop.querySelectorAll('.rpcm-log-row').forEach(row => {
        const pin = row.querySelector('.rpcm-log-pin');
        const ex = row.querySelector('.rpcm-log-exclude');
        const man = row.querySelector('.rpcm-log-manual');
        pin.onchange = () => { if (pin.checked) ex.checked = false; };
        ex.onchange = () => { if (ex.checked) pin.checked = false; };
        man.onchange = updateGroupState;
      });
      backdrop.querySelectorAll('.rpcm-log-group-select').forEach(group => group.onchange = () => {
        const desired = group.checked;
        for (const key of String(group.dataset.keys || '').split('|').filter(Boolean)) {
          const cb = backdrop.querySelector(`.rpcm-log-row[data-log-key="${CSS.escape(key)}"] .rpcm-log-manual`);
          if (cb) cb.checked = desired;
        }
        updateGroupState();
      });
      backdrop.querySelector('#rpcm-log-clear-manual').onclick = () => {
        backdrop.querySelectorAll('.rpcm-log-manual').forEach(cb => { cb.checked = false; });
        updateGroupState();
      };
      backdrop.querySelector('[data-act="confirm"]').onclick = () => {
        const nextPinned = [], nextExcluded = [], nextManual = [];
        backdrop.querySelectorAll('.rpcm-log-row').forEach(row => {
          const key = row.dataset.logKey;
          if (row.querySelector('.rpcm-log-pin')?.checked) nextPinned.push(key);
          if (row.querySelector('.rpcm-log-exclude')?.checked) nextExcluded.push(key);
          if (row.querySelector('.rpcm-log-manual')?.checked) nextManual.push(key);
        });
        room.autoLogPinnedKeys = nextPinned;
        room.autoLogExcludedKeys = nextExcluded;
        room.manualLogSelectedKeys = nextManual;
        finish(true);
      };
      updateGroupState();
      backdrop.onclick = e => { if (e.target === backdrop) finish(false); };
    });
  }

  function openDuplicateLogResolverDialog(room) {
    return new Promise(resolve => {
      const log = (room.slots || []).find(s => s.id === 'logSummary');
      const blocks = parseDatedLogBlocks(log?.content || '');
      const groups = duplicateLogDateGroups(room);
      if (!groups.length) { notify('현재 중복 날짜 로그가 없습니다.', 'success', 3200); resolve(false); return; }

      const old = document.getElementById('rpcm-dup-dialog-backdrop');
      if (old) old.remove();
      const backdrop = document.createElement('div');
      backdrop.id = 'rpcm-dup-dialog-backdrop';

      const groupsHtml = groups.map((group, gi) => `
        <div class="rpcm-dup-group" data-date-key="${esc(group.dateKey)}">
          <div class="rpcm-dup-group-head"><strong>${esc(group.label)}</strong><span>${group.blocks.length}개 블록 감지 · 유지할 블록 하나를 선택하세요.</span></div>
          ${group.blocks.map((b, bi) => `
            <div class="rpcm-dup-choice ${bi === group.blocks.length - 1 ? 'is-selected' : ''}" data-block-index="${b.index}">
              <label class="rpcm-dup-choice-head">
                <input type="radio" name="rpcm-dup-${gi}" value="${b.index}" ${bi === group.blocks.length - 1 ? 'checked' : ''}>
                <strong>${bi + 1}번째 블록${bi === group.blocks.length - 1 ? ' · 기본 선택' : ''}</strong>
                <span>${formatCount(b.raw.length)}자</span>
              </label>
              <textarea class="rpcm-dup-editor" spellcheck="false">${esc(b.raw)}</textarea>
            </div>`).join('')}
        </div>`).join('');

      backdrop.innerHTML = `
        <div class="rpcm-log-dialog rpcm-dup-dialog" role="dialog" aria-modal="true">
          <div class="rpcm-lib-dialog-head"><div><div class="rpcm-lib-dialog-title">중복 날짜 로그 정리</div><div class="rpcm-lib-dialog-desc">같은 날짜로 감지된 블록을 비교해 하나만 남깁니다. 선택한 블록은 여기서 바로 수정할 수 있고, 적용하면 나머지 중복 블록은 로그요약 원문에서 제거됩니다.</div></div><button type="button" class="rpcm-lib-close">✕</button></div>
          <div class="rpcm-log-help"><b>안전 기본값</b>=같은 날짜에서 뒤쪽(나중에 붙여넣은) 블록을 기본 선택합니다. 적용 전 내용을 비교하고 필요한 경우 선택/수정하세요.</div>
          <div class="rpcm-log-list rpcm-dup-list">${groupsHtml}</div>
          <div class="rpcm-lib-dialog-actions"><div class="rpcm-spacer"></div><button type="button" class="rpcm-btn secondary" data-act="cancel">취소</button><button type="button" class="rpcm-btn primary" data-act="confirm">선택한 블록으로 정리</button></div>
        </div>`;
      document.body.appendChild(backdrop);

      const finish = value => { backdrop.remove(); resolve(value); };
      backdrop.querySelector('.rpcm-lib-close').onclick = () => finish(false);
      backdrop.querySelector('[data-act="cancel"]').onclick = () => finish(false);
      backdrop.querySelectorAll('.rpcm-dup-choice input[type="radio"]').forEach(radio => {
        radio.onchange = () => {
          const group = radio.closest('.rpcm-dup-group');
          group?.querySelectorAll('.rpcm-dup-choice').forEach(choice => choice.classList.toggle('is-selected', !!choice.querySelector('input[type="radio"]')?.checked));
        };
      });
      backdrop.querySelector('[data-act="confirm"]').onclick = () => {
        const selectedByDate = new Map();
        for (const group of groups) {
          const groupEl = backdrop.querySelector(`.rpcm-dup-group[data-date-key="${CSS.escape(group.dateKey)}"]`);
          const selected = groupEl?.querySelector('input[type="radio"]:checked');
          if (!selected) { notify(`${group.label}: 유지할 블록을 선택해 주세요.`, 'warn', 4200); return; }
          const choice = selected.closest('.rpcm-dup-choice');
          const edited = String(choice?.querySelector('.rpcm-dup-editor')?.value || '').trim();
          if (!edited) { notify(`${group.label}: 선택한 블록 내용이 비어 있습니다.`, 'warn', 4200); return; }
          selectedByDate.set(group.dateKey, { index: Number(selected.value), text: edited });
        }

        const src = normalizeLineBreaks(log?.content || '');
        const prefix = blocks.length && blocks[0].sourceStart > 0 ? src.slice(0, blocks[0].sourceStart).trim() : '';
        const duplicateDates = new Set(groups.map(g => g.dateKey));
        const pieces = prefix ? [prefix] : [];
        for (const block of blocks) {
          if (!duplicateDates.has(block.dateKey)) {
            pieces.push(String(block.raw || '').trim());
            continue;
          }
          const chosen = selectedByDate.get(block.dateKey);
          if (chosen?.index === block.index) pieces.push(chosen.text);
        }
        log.content = pieces.filter(Boolean).join('\n\n').trim();
        pruneLogSelectionKeys(room, parseDatedLogBlocks(log.content));
        finish(true);
      };
      backdrop.onclick = e => { if (e.target === backdrop) finish(false); };
    });
  }

  // ---------------------------------------------------------------------------
  // IndexedDB
  // ---------------------------------------------------------------------------

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(APP.dbName, APP.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(APP.storeName)) {
          db.createObjectStore(APP.storeName, { keyPath: 'chatId' });
        }
        if (!db.objectStoreNames.contains(APP.libraryStoreName)) {
          db.createObjectStore(APP.libraryStoreName, { keyPath: 'scopeId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbTx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.storeName, mode);
      const store = tx.objectStore(APP.storeName);
      let result;
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('DB transaction aborted'));
    });
  }

  async function getRoom(chatId, apiChatId = null) {
    const room = await new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.storeName, 'readonly');
      const req = tx.objectStore(APP.storeName).get(chatId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (room) {
      normalizeRoomSlots(room);
      room.maxChars = APP.defaultMaxChars;
      room.apiChatId = room.apiChatId || apiChatId || String(chatId).split('::')[0];
      if (room.pending) {
        room.pending.contextBlock = String(room.pending.contextBlock || '');
        room.pending.sessionStartedAt = Number(room.pending.sessionStartedAt || room.pending.armedAt || Date.now());
        if (!Array.isArray(room.pending.items) || !room.pending.items.length) {
          const legacyTotal = room.pending.totalTurns == null ? APP.defaultRetentionTurns : normalizeRetentionTurns(room.pending.totalTurns);
          const legacyUsed = Number(room.pending.usedTurns || 0);
          room.pending.items = selectedSlots(room).map(slot => ({
            slotId: slot.id, title: slot.title, group: slot.group, content: String(slot.content || ''),
            totalTurns: normalizeRetentionTurns(slot.retentionTurns ?? legacyTotal), usedTurns: legacyUsed,
          }));
        }
      }
      return room;
    }

    const created = {
      chatId,
      apiChatId: apiChatId || String(chatId).split('::')[0],
      label: '',
      maxChars: APP.defaultMaxChars,
      slots: cloneSlots(),
      pending: null,
      autoCharacterDetection: false,
      autoCharacterLibraryId: '',
      autoCharacterResetOnReappear: true,
      autoLogRecallEnabled: false,
      autoLogRecentBlocks: APP.defaultRecentLogBlocks,
      autoLogRelatedBlocks: APP.defaultRelatedLogBlocks,
      autoLogPinnedKeys: [],
      autoLogExcludedKeys: [],
      autoScanLastMessageId: '',
      autoRecallContextText: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await saveRoom(created);
    return created;
  }

  function updateSaveStatusUi(status = state.saveStatus) {
    state.saveStatus = status;
    const el = state.modal?.querySelector('#rpcm-save-status');
    if (!el) return;
    if (status === 'saving') { el.textContent = '로컬 저장 중…'; el.className = 'rpcm-save-status saving'; return; }
    if (status === 'error') { el.textContent = '로컬 저장 실패'; el.className = 'rpcm-save-status error'; return; }
    const when = state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
    el.textContent = when ? `로컬 저장됨 · ${when}` : '로컬 저장됨';
    el.className = 'rpcm-save-status saved';
  }

  function queueRoomAutoSave(room, delay = 500) {
    if (!room) return;
    const key = String(room.chatId || '');
    const previous = state.autoSaveTimers.get(key);
    if (previous) clearTimeout(previous);
    updateSaveStatusUi('saving');
    const timer = setTimeout(async () => {
      state.autoSaveTimers.delete(key);
      try { await saveRoom(room); }
      catch (e) { updateSaveStatusUi('error'); console.warn('[🪽위시 RP Manager] 자동저장 실패', e); }
    }, delay);
    state.autoSaveTimers.set(key, timer);
  }

  async function saveRoom(room) {
    room.updatedAt = nowIso();
    await new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.storeName, 'readwrite');
      const req = tx.objectStore(APP.storeName).put(room);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    if (room.chatId === state.currentChatId) {
      state.lastSavedAt = Date.now();
      updateSaveStatusUi('saved');
    }
  }

  async function getAllRooms() {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.storeName, 'readonly');
      const req = tx.objectStore(APP.storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearCurrentRoom(chatId) {
    await new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.storeName, 'readwrite');
      const req = tx.objectStore(APP.storeName).delete(chatId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getCharacterLibrary(scopeId) {
    if (!scopeId) return null;
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.libraryStoreName, 'readonly');
      const req = tx.objectStore(APP.libraryStoreName).get(scopeId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveCharacterLibrary(library) {
    if (!library?.scopeId) throw new Error('캐릭터 설정집 범위를 찾지 못했습니다.');
    library.updatedAt = nowIso();
    await new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.libraryStoreName, 'readwrite');
      const req = tx.objectStore(APP.libraryStoreName).put(library);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllCharacterLibraries() {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(APP.libraryStoreName, 'readonly');
      const req = tx.objectStore(APP.libraryStoreName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function characterSlotsForLibrary(room) {
    return (room?.slots || []).filter(s => s.group === 'character').map(s => ({
      title: String(s.title || '캐릭터').trim() || '캐릭터',
      aliases: Array.isArray(s.aliases) ? [...s.aliases] : [],
      content: String(s.content || ''),
      retentionTurns: normalizeRetentionTurns(s.retentionTurns),
    }));
  }

  function libraryItemKey(item) {
    return String(item?.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function mergeCharacterLibraryItems(existingItems, selectedItems, preserveUnselected = true) {
    if (!preserveUnselected) return selectedItems.map(x => ({ ...x, aliases: [...(x.aliases || [])] }));
    const result = (existingItems || []).map(x => ({ ...x, aliases: [...(x.aliases || [])] }));
    const index = new Map(result.map((x, i) => [libraryItemKey(x), i]));
    for (const item of selectedItems || []) {
      const key = libraryItemKey(item);
      const next = { ...item, aliases: [...(item.aliases || [])] };
      if (key && index.has(key)) result[index.get(key)] = next;
      else { index.set(key, result.length); result.push(next); }
    }
    return result;
  }

  function applySelectedCharacterLibraryToRoom(room, selectedItems) {
    const chars = (room.slots || []).filter(s => s.group === 'character');
    const byKey = new Map(chars.map(s => [libraryItemKey(s), s]));
    let added = 0, updated = 0;
    for (const src of selectedItems || []) {
      const key = libraryItemKey(src);
      let slot = key ? byKey.get(key) : null;
      if (!slot) {
        slot = makeDynamicSlot('character', String(src.title || '캐릭터'));
        room.slots.push(slot);
        byKey.set(key, slot);
        added++;
      } else { updated++; }
      slot.title = String(src.title || '캐릭터');
      slot.aliases = Array.isArray(src.aliases) ? [...src.aliases] : [];
      slot.content = String(src.content || '');
      slot.retentionTurns = normalizeRetentionTurns(src.retentionTurns);
      slot.autoExcluded = !!slot.autoExcluded;
      slot.enabled = false; // 불러온 항목은 현재 방에서 사용자가 직접 체크
    }
    normalizeRoomSlots(room);
    return { count: (selectedItems || []).length, added, updated };
  }

  async function findCharacterLibraryForRoom(room = state.currentRoom) {
    const candidates = getCharacterLibraryScopeCandidates(room);
    for (const scopeId of candidates) {
      const exact = await getCharacterLibrary(scopeId);
      if (exact?.characters?.length) return { library: exact, match: 'scope' };
    }
    const all = await getAllCharacterLibraries();
    for (const lib of all) {
      const aliases = Array.isArray(lib.scopeAliases) ? lib.scopeAliases : [];
      if (aliases.some(a => candidates.includes(a)) && lib?.characters?.length) return { library: lib, match: 'alias' };
    }
    const labelKey = normalizedLibraryLabel(room?.label);
    if (labelKey) {
      const matches = all.filter(lib => normalizedLibraryLabel(lib.label) === labelKey && lib?.characters?.length);
      if (matches.length) {
        matches.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        return { library: matches[0], match: 'label' };
      }
    }
    return { library: null, match: 'none' };
  }

  // ---------------------------------------------------------------------------
  // Crack API
  // ---------------------------------------------------------------------------

  function apiRequest(method, url, body = undefined) {
    const token = getCookie('access_token');
    if (!token) return Promise.reject(new Error('로그인 토큰을 찾지 못했습니다. 페이지를 새로고침해 주세요.'));

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          platform: 'web',
          'wrtn-locale': 'ko-KR',
        },
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout: 20000,
        onload: res => {
          let parsed = null;
          try { parsed = res.responseText ? JSON.parse(res.responseText) : null; } catch (_) {}
          if (res.status >= 200 && res.status < 300) {
            resolve(parsed ?? { ok: true });
          } else {
            const detail = parsed?.message || parsed?.error || res.responseText?.slice(0, 250) || '';
            reject(new Error(`API 오류 ${res.status}${detail ? `: ${detail}` : ''}`));
          }
        },
        ontimeout: () => reject(new Error('API 요청 시간 초과')),
        onerror: () => reject(new Error('네트워크 오류')),
      });
    });
  }

  async function fetchRecentMessages(chatId, limit = 30) {
    // CrackSafe uses the crack-gen messages endpoint; it returns newest-first.
    const url = `https://crack-api.wrtn.ai/crack-gen/v3/chats/${chatId}/messages?limit=${limit}`;
    const data = await apiRequest('GET', url);
    return data?.data?.messages || data?.messages || [];
  }

  async function fetchMessage(chatId, messageId) {
    try {
      const url = `https://crack-api.wrtn.ai/crack-gen/v3/chats/${chatId}/messages/${messageId}`;
      const data = await apiRequest('GET', url);
      return data?.data || data || null;
    } catch (_) {
      const recent = await fetchRecentMessages(chatId, 50);
      return recent.find(m => messageIdOf(m) === messageId) || null;
    }
  }

  async function patchMessage(chatId, messageId, nextText) {
    // Primary endpoint verified by existing Crack scripts.
    const candidates = [
      `https://contents-api.wrtn.ai/character-chat/v3/chats/${chatId}/messages/${messageId}`,
      `https://contents-api.wrtn.ai/character-chat/character-chats/${chatId}/messages/${messageId}`,
      `https://crack-api.wrtn.ai/crack-gen/v3/chats/${chatId}/messages/${messageId}`,
    ];
    let lastErr = null;
    for (const url of candidates) {
      try {
        await apiRequest('PATCH', url, { message: nextText });
        return true;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('메시지 PATCH 실패');
  }

  async function fetchRoomMeta(chatId) {
    try {
      const data = await apiRequest('GET', `https://crack-api.wrtn.ai/crack-gen/v3/chats/${chatId}`);
      const d = data?.data || data || {};
      const label = d?.story?.name || d?.character?.name || d?.title || '';
      const ids = [
        d?.story?._id, d?.story?.id, d?.story?.storyId, d?.story?.characterId, d?.story?.character?._id, d?.story?.character?.id,
        d?.character?._id, d?.character?.id, d?.character?.characterId, d?.characterId, d?.storyId
      ].filter(Boolean).map(String);
      return { label, characterScopeIds: [...new Set(ids)] };
    } catch (_) {
      return { label: '', characterScopeIds: [] };
    }
  }

  async function fetchRoomLabel(chatId) {
    return (await fetchRoomMeta(chatId)).label;
  }

  // ---------------------------------------------------------------------------
  // Context building / cleanup
  // ---------------------------------------------------------------------------

  function selectedSlots(room) {
    return (room.slots || []).filter(s => s.enabled && String(s.content || '').trim());
  }

  function snapshotSelectedItems(room, contextText = null, contextBudget = null) {
    const ctx = contextText == null ? String(room.autoRecallContextText || '') : String(contextText || '');
    const out = [];
    for (const s of selectedSlots(room)) {
      if (s.id === 'logSummary') continue; // v0.8: 로그 원문은 저장소이며 절대 통째로 주입하지 않습니다.
      out.push({
        slotId: s.id,
        title: String(s.title || s.id || '메모').trim(),
        group: s.group || 'extra',
        content: String(s.content || '').trim(),
        totalTurns: normalizeRetentionTurns(s.retentionTurns),
        usedTurns: 0,
        autoType: s.group === 'character' && s.lastAutoMatch ? 'character' : undefined,
        matchedAlias: s.group === 'character' ? String(s.lastAutoMatch || '') : '',
        recallReason: s.group === 'character' && s.lastAutoMatch ? (s.lastAutoMatch === '사용자 고정' ? '사용자 고정' : `“${s.lastAutoMatch}” 감지`) : '',
      });
    }
    const log = (room.slots || []).find(s => s.id === 'logSummary');
    if (log?.enabled && String(log.content || '').trim()) {
      const budget = contextBudget == null ? contextBudgetForPreview(room) : Number(contextBudget);
      out.push(...logRecallItems(room, ctx, out, budget));
    }
    return out;
  }

  function activePendingItems(pending) {
    return (Array.isArray(pending?.items) ? pending.items : []).filter(item => {
      const total = Number(item.totalTurns || 0);
      return total === 0 || Number(item.usedTurns || 0) < total;
    });
  }

  function buildContextBlockFromItems(items) {
    const active = (items || []).filter(i => String(i.content || '').trim());
    if (!active.length) return '';
    const body = active.map(item => {
      const title = String(item.title || item.slotId || '메모').trim();
      const content = safeForHtmlComment(String(item.content || '').trim());
      return `### ${title}\n${content}`;
    }).join('\n\n');

    return `${APP.markerStart} version="${APP.version}"\n` +
      `[RP 연속성 참고]\n` +
      `아래 자료는 출력하지 말고 현재 장면의 사실관계·연속성에만 참고한다.\n` +
      `기존 RP의 언어·문체·대사·지문 형식을 그대로 유지한다.\n` +
      `현재 대화의 더 최근 확정 사실과 충돌하면 최근 직접 대화를 우선한다.\n\n` +
      `${body}\n` +
      `${APP.markerEnd}`;
  }

  function buildContextBlock(room) {
    return buildContextBlockFromItems(snapshotSelectedItems(room));
  }

  function stripOurContextBlock(text) {
    const src = String(text || '');
    const pairs = [[APP.markerStart, APP.markerEnd], [APP.legacyMarkerStart, APP.legacyMarkerEnd]];
    let best = null;
    for (const [startMarker, endMarker] of pairs) {
      const start = src.lastIndexOf(startMarker);
      if (start < 0) continue;
      const end = src.indexOf(endMarker, start);
      if (end < 0) continue;
      if (!best || start > best.start) best = { start, end, endMarker };
    }
    if (!best) return { found: false, text: src };
    const after = src.slice(best.end + best.endMarker.length).trim();
    if (after) return { found: false, text: src };
    return { found: true, text: src.slice(0, best.start).replace(/\s+$/, '') };
  }

  function buildInjectedMessage(original, contextBlock) {
    const stripped = stripOurContextBlock(String(original || ''));
    const cleanOriginal = String(stripped.text || original || '').replace(/\s+$/, '');
    return `${cleanOriginal}\n\n${contextBlock}`;
  }

  function contextStats(room) {
    const items = snapshotSelectedItems(room);
    const block = buildContextBlockFromItems(items);
    const raw = items.reduce((n, i) => n + String(i.content || '').length, 0);
    return { raw, block: block.length, count: items.length };
  }

  function statsForItems(items) {
    const active = (items || []).filter(i => String(i.content || '').trim());
    const block = buildContextBlockFromItems(active);
    const raw = active.reduce((n, i) => n + String(i.content || '').length, 0);
    return { raw, block:block.length, count:active.length };
  }

  function itemCategory(item) {
    if (item.slotId === 'currentState') return '현재상태';
    if (item.autoType === 'pinned-log') return '고정로그';
    if (item.autoType === 'manual-log') return '직접로그';
    if (item.autoType === 'recent-log') return '최근로그';
    if (item.autoType === 'related-log') return '관련로그';
    if (item.slotId === 'logSummary') return '로그요약';
    if (item.group === 'character') return '캐릭터';
    if (item.group === 'extra') return '기타';
    return '기타';
  }

  function contextBreakdown(items) {
    const map = new Map();
    for (const item of (items || [])) {
      const key = itemCategory(item);
      const cur = map.get(key) || { count:0, chars:0 };
      cur.count++;
      cur.chars += String(item.content || '').length;
      map.set(key, cur);
    }
    const order = ['현재상태','고정로그','직접로그','최근로그','관련로그','로그요약','캐릭터','기타'];
    return order.filter(k => map.has(k)).map(k => ({ label:k, ...map.get(k) }));
  }

  function itemReason(item) {
    if (item.recallReason) return String(item.recallReason);
    if (item.autoType === 'character' && item.matchedAlias) return `“${item.matchedAlias}” 감지`;
    if (item.autoType === 'manual-log') return '사용자 직접 선택';
    if (item.autoType === 'recent-log') return '최신 날짜 기본 유지';
    if (item.autoType === 'pinned-log') return '사용자 고정';
    if (item.autoType === 'related-log') return '현재 RP와 관련';
    return '';
  }

  function getDataWarnings(room) {
    const warnings = [];
    const log = (room.slots || []).find(x => x.id === 'logSummary');
    const blocks = parseDatedLogBlocks(log?.content || '');
    if (String(log?.content || '').trim() && !blocks.length && String(log.content || '').length > APP.legacyWholeLogFallbackMax) warnings.push('로그요약이 길지만 날짜 블록을 감지하지 못해 통짜 주입을 차단함. [YYYY년 M월 D일-사건명] 형식을 사용해 주세요.');
    if (blocks.length) {
      const noYearCount = blocks.filter(b => !b.isUnknown && b.year == null).length;
      const unknownCount = blocks.filter(b => b.isUnknown).length;
      if (noYearCount) warnings.push(`연도 없는 날짜 로그 ${noYearCount}개 있음. ‘날짜 정리’에서 선택한 항목에 2024년/2025년처럼 연도를 일괄 적용할 수 있음.`);
      if (unknownCount) warnings.push(`날짜 미상 로그 ${unknownCount}개 있음. 미상으로 유지해도 되며, 실제 날짜를 아는 항목만 ‘날짜 정리’에서 지정할 수 있음.`);
      const byDate = new Map();
      for (const b of blocks) {
        if (b.isUnknown) continue;
        byDate.set(b.dateKey, (byDate.get(b.dateKey) || 0) + 1);
      }
      const dupDates = [...byDate.entries()].filter(([,n]) => n > 1).map(([k,n]) => `${k.replace(/^x-/, '')} (${n}개)`);
      if (dupDates.length) warnings.push(`같은 날짜 로그가 여러 블록으로 감지됨: ${dupDates.join(', ')}`);
    }
    const chars = (room.slots || []).filter(x => x.group === 'character');
    const byName = new Map();
    for (const c of chars) {
      const k = libraryItemKey(c);
      if (!k) continue;
      byName.set(k, (byName.get(k) || 0) + 1);
    }
    const dupChars = [...byName.entries()].filter(([,n]) => n > 1).map(([k,n]) => `${k} (${n}개)`);
    if (dupChars.length) warnings.push(`같은 이름의 캐릭터 설정이 중복됨: ${dupChars.join(', ')}`);
    if (room._logBudgetInfo?.omitted) warnings.push(`45,000자 예산 때문에 로그 ${room._logBudgetInfo.omitted}개를 이번 주입 후보에서 자동 제외함.${room._logBudgetInfo.omittedTitles?.length ? ` (${room._logBudgetInfo.omittedTitles.join(', ')})` : ''}`);
    return warnings;
  }

  function buildStructuredPreviewText(room, items) {
    const active = (items || []).filter(i => String(i.content || '').trim());
    const stats = statsForItems(active);
    const lines = [`[${room.pending ? '현재 서버 주입 구성' : '다음 주입 구성'}] ${formatCount(stats.block)}자 · ${active.length}개 항목 · 한도 45,000자`, ''];
    for (const item of active) {
      const reason = itemReason(item);
      lines.push(`[${itemCategory(item)}] ${item.title} · ${formatCount(String(item.content || '').length)}자 · ${remainingLabelForItem(item)}${reason ? ` · ${reason}` : ''}`);
      lines.push(String(item.content || '').trim());
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  // ---------------------------------------------------------------------------
  // Injection lifecycle
  // ---------------------------------------------------------------------------

  async function verifyInjectedCarrier(room, pending, expectedText, attempts = 4) {
    let lastText = '';
    for (let i = 0; i < attempts; i++) {
      if (i) await sleep([300, 650, 1100, 1600][Math.min(i - 1, 3)]);
      const current = await fetchMessage(apiChatIdOf(room), pending.messageId);
      if (!current) continue;
      const text = messageTextOf(current);
      lastText = text;
      const hasMarkers = text.includes(APP.markerStart) && text.includes(APP.markerEnd);
      const stripped = stripOurContextBlock(text);
      const originalMatches = stripped.found && normalizeLineBreaks(stripped.text) === normalizeLineBreaks(String(pending.originalText || '').replace(/\s+$/, ''));
      const exactMatches = normalizeLineBreaks(text) === normalizeLineBreaks(expectedText);
      if (hasMarkers && originalMatches && exactMatches) {
        return { verified: true, serverChars: text.length, text };
      }
    }
    return { verified: false, serverChars: lastText.length, text: lastText };
  }

  async function reverifyPending(room) {
    const p = room.pending;
    if (!p) throw new Error('현재 예약된 임시 주입이 없습니다.');
    const current = await fetchMessage(apiChatIdOf(room), p.messageId);
    if (!current) throw new Error('carrier AI 메시지를 서버에서 다시 읽지 못했습니다.');
    const text = messageTextOf(current);
    const stripped = stripOurContextBlock(text);
    const ok = stripped.found && normalizeLineBreaks(stripped.text) === normalizeLineBreaks(String(p.originalText || '').replace(/\s+$/, ''));
    p.verified = ok;
    p.verifiedAt = ok ? Date.now() : null;
    p.serverChars = text.length;
    await saveRoom(room);
    if (room.chatId === state.currentChatId) state.currentRoom = room;
    return { verified: ok, text, serverChars: text.length };
  }

  async function showInjectedRaw(room) {
    if (!room.pending) throw new Error('현재 예약된 임시 주입이 없습니다.');
    const result = await reverifyPending(room);
    const overlay = state.modal;
    if (!overlay) return;
    let viewer = overlay.querySelector('#rpcm-raw-viewer');
    if (viewer) viewer.remove();
    viewer = document.createElement('div');
    viewer.id = 'rpcm-raw-viewer';
    viewer.innerHTML = `
      <div class="rpcm-raw-card">
        <div class="rpcm-raw-head">
          <div><strong>${result.verified ? '✅ 서버 주입 확인됨' : '⚠️ 서버 주입 확인 실패'}</strong><div>carrier AI ${esc(shortId(room.pending.messageId))} · 서버 raw ${formatCount(result.serverChars)}자</div></div>
          <button class="rpcm-iconbtn" id="rpcm-raw-close">✕</button>
        </div>
        <div class="rpcm-raw-note">아래는 서버에서 다시 읽은 현재 carrier AI의 실제 raw입니다. 일반 채팅 화면에는 숨김 블록이 보이지 않는 것이 정상이며, AI 응답이 생기면 이 블록은 최신 AI 메시지로 자동 이동합니다. 이 창에서는 수정하지 않습니다.</div>
        <textarea class="rpcm-raw-text" readonly></textarea>
      </div>`;
    overlay.appendChild(viewer);
    viewer.querySelector('.rpcm-raw-text').value = result.text || '(서버 원문 없음)';
    viewer.querySelector('#rpcm-raw-close').onclick = () => viewer.remove();
  }

  async function carrierOriginalFromServer(room, p) {
    const current = await fetchMessage(apiChatIdOf(room), p.messageId);
    if (!current) return { found: false, original: '', currentText: '' };
    const currentText = messageTextOf(current);
    const stripped = stripOurContextBlock(currentText);
    if (stripped.found) {
      // Refiner가 주입 중인 메시지의 가시 본문을 교정했을 수 있습니다.
      // 세션 시작 때 저장한 p.originalText보다 서버의 최신 가시 본문을 우선합니다.
      return { found: true, original: stripped.text, currentText };
    }
    return { found: false, original: currentText, currentText };
  }

  async function verifyCarrierClean(room, messageId, expectedText, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      if (i) await sleep([250, 600][Math.min(i - 1, 1)]);
      const current = await fetchMessage(apiChatIdOf(room), messageId);
      if (!current) return { clean: true, reason: 'message_missing' };
      const text = messageTextOf(current);
      if (!stripOurContextBlock(text).found && normalizeLineBreaks(text) === normalizeLineBreaks(expectedText)) {
        return { clean: true, reason: 'verified' };
      }
    }
    return { clean: false, reason: 'verify_failed' };
  }

  async function restoreCarrierOnly(room, p) {
    const info = await carrierOriginalFromServer(room, p);
    if (!info.currentText) return { restored: false, reason: 'message_missing' };
    if (!stripOurContextBlock(info.currentText).found) return { restored: false, reason: 'already_clean' };
    const restoreText = info.original;
    if (restoreText == null) throw new Error('복원할 최신 AI 원문을 찾지 못했습니다.');
    await patchMessage(apiChatIdOf(room), p.messageId, restoreText);
    const verification = await verifyCarrierClean(room, p.messageId, restoreText);
    if (!verification.clean) throw new Error('AI 원문 복원 후 서버 재검증에 실패했습니다. 복구 정보는 유지됩니다.');
    return { restored: true, reason: 'ok' };
  }


  function clonePendingItems(items) {
    return (Array.isArray(items) ? items : []).map(i => ({ ...i }));
  }

  function slotToPendingItem(slot) {
    return {
      slotId: slot.id,
      title: String(slot.title || slot.id || '메모').trim(),
      group: slot.group || 'extra',
      content: String(slot.content || '').trim(),
      totalTurns: normalizeRetentionTurns(slot.retentionTurns),
      usedTurns: 0,
      autoType: slot.group === 'character' && slot.lastAutoMatch ? 'character' : undefined,
      matchedAlias: slot.group === 'character' ? String(slot.lastAutoMatch || '') : '',
      recallReason: slot.group === 'character' && slot.lastAutoMatch ? (slot.lastAutoMatch === '사용자 고정' ? '사용자 고정' : `“${slot.lastAutoMatch}” 감지`) : '',
    };
  }

  function ensureDirectReleasePendingItems(room, pending) {
    if (!room || !pending) return { added: 0 };
    const items = Array.isArray(pending.items) ? pending.items : (pending.items = []);
    let added = 0;

    // 유지주기 0(직접 해제)은 AI 응답마다 차감되지 않아야 하며,
    // 다른 자동 갱신 과정에서 빠졌더라도 사용자가 체크를 유지 중이면 복구합니다.
    for (const slot of selectedSlots(room)) {
      if (slot.id === 'logSummary') continue;
      if (normalizeRetentionTurns(slot.retentionTurns) !== 0) continue;
      if (!String(slot.content || '').trim()) continue;
      const exists = activePendingItems(pending).some(i => i.slotId === slot.id);
      if (!exists) { items.push(slotToPendingItem(slot)); added++; }
    }

    // v0.8 로그요약은 원문 자체가 아니라 날짜 블록들이 carrier에 들어갑니다.
    // 로그요약이 '직접 해제'이고 체크된 상태라면 활성 로그가 통째로 유실된 경우에만 재구성합니다.
    const logSlot = (room.slots || []).find(s => s.id === 'logSummary');
    if (logSlot?.enabled && normalizeRetentionTurns(logSlot.retentionTurns) === 0 && String(logSlot.content || '').trim()) {
      const hasActiveLog = activePendingItems(pending).some(i => i.sourceSlotId === 'logSummary' || i.group === 'log-auto' || i.slotId === 'logSummary');
      if (!hasActiveLog) {
        const base = activePendingItems(pending).filter(i => i.sourceSlotId !== 'logSummary' && i.group !== 'log-auto' && i.slotId !== 'logSummary');
        const recalled = logRecallItems(room, room.autoRecallContextText || '', base, contextBudgetForCarrier(room, String(pending.originalText || '').length));
        if (recalled.length) { items.push(...recalled); added += recalled.length; }
      }
    }
    return { added };
  }

  async function syncPendingCarrier(room, reason = 'update') {
    const p = room.pending;
    if (!p) return { active: 0, cleared: false };
    // 다른 확프(예: Lore Refiner)가 carrier의 가시 본문을 수정했다면 그 최신값을 기준으로
    // 숨김 블록을 다시 붙입니다. 과거 p.originalText로 교정 결과를 덮어쓰지 않습니다.
    const live = await carrierOriginalFromServer(room, p);
    if (live.currentText) p.originalText = live.original;
    ensureDirectReleasePendingItems(room, p);
    let active = activePendingItems(p);
    const nonLogs = active.filter(i => i.sourceSlotId !== 'logSummary' && i.group !== 'log-auto' && i.slotId !== 'logSummary');
    const logs = active.filter(i => i.sourceSlotId === 'logSummary' || i.group === 'log-auto' || i.slotId === 'logSummary');
    if (logs.length) {
      const fittedLogs = fitLogItemsToBudget(room, nonLogs, logs, contextBudgetForCarrier(room, String(p.originalText || '').length));
      const keepIds = new Set(fittedLogs.map(i => i.slotId));
      p.items = (p.items || []).filter(i => !(i.sourceSlotId === 'logSummary' || i.group === 'log-auto' || i.slotId === 'logSummary') || keepIds.has(i.slotId));
      active = [...nonLogs, ...fittedLogs];
    }
    if (!active.length) {
      await restoreCarrierOnly(room, p);
      room.pending = null;
      clearPendingBackup(room.chatId);
      await saveRoom(room);
      if (room.chatId === state.currentChatId) {
        state.currentRoom = room;
        notifyInjectionEnded(room, 'empty');
      }
      renderModalIfOpen();
      return { active: 0, cleared: true };
    }
    const contextBlock = buildContextBlockFromItems(active);
    const injectedText = buildInjectedMessage(p.originalText, contextBlock);
    const maxChars = Number(room.maxChars) || APP.defaultMaxChars;
    if (injectedText.length > maxChars) throw new Error(`변경 후 carrier 총 길이가 ${formatCount(injectedText.length)}자로 주입 한도 ${formatCount(maxChars)}자를 넘습니다.`);
    const previousInjectedText = buildInjectedMessage(p.originalText, p.contextBlock || buildContextBlockFromItems(activePendingItems(p)));
    await patchMessage(apiChatIdOf(room), p.messageId, injectedText);
    const next = { ...p, contextBlock, injectedChars: contextBlock.length, carrierChars: injectedText.length, verified: false, verifiedAt: null };
    const verification = await verifyInjectedCarrier(room, next, injectedText);
    if (!verification.verified) {
      try { await patchMessage(apiChatIdOf(room), p.messageId, previousInjectedText); } catch (_) {}
      throw new Error('변경된 컨텍스트의 서버 재검증에 실패했습니다. 이전 주입 상태 복원을 시도했습니다.');
    }
    next.verified = true; next.verifiedAt = Date.now(); next.serverChars = verification.serverChars;
    room.pending = next;
    savePendingBackup(room.chatId, next);
    await saveRoom(room);
    if (room.chatId === state.currentChatId) state.currentRoom = room;
    sanitizeRenderedContextSoon();
    return { active: active.length, cleared: false, reason };
  }

  function replacePendingLogItems(room) {
    if (!room.pending) return 0;
    const p = room.pending;
    const previousLogs = activePendingItems(p).filter(i => i.slotId === 'logSummary' || i.sourceSlotId === 'logSummary' || i.group === 'log-auto');
    const previousBySource = new Map(previousLogs.map(i => [String(i.sourceKey || i.slotId || ''), i]));
    p.items = (Array.isArray(p.items) ? p.items : []).filter(i => i.slotId !== 'logSummary' && i.sourceSlotId !== 'logSummary' && i.group !== 'log-auto');
    const slot = (room.slots || []).find(s => s.id === 'logSummary');
    if (!slot?.enabled || !String(slot.content || '').trim()) return 0;
    const blocks = parseDatedLogBlocks(slot.content);
    if (blocks.length) pruneLogSelectionKeys(room, blocks);
    const base = activePendingItems(p).filter(i => i.slotId !== 'logSummary' && i.sourceSlotId !== 'logSummary' && i.group !== 'log-auto');
    const next = logRecallItems(room, room.autoRecallContextText || '', base, contextBudgetForCarrier(room, String(p.originalText || '').length));
    for (const item of next) {
      const prev = previousBySource.get(String(item.sourceKey || item.slotId || ''));
      if (!prev) continue;
      // 같은 날짜 블록이 재선정되면 이미 사용한 유지턴은 그대로 이어갑니다.
      // 새로 생긴 날짜 블록만 0턴부터 시작합니다.
      item.usedTurns = Number(prev.usedTurns || 0);
      item.totalTurns = normalizeRetentionTurns(slot.retentionTurns);
    }
    p.items.push(...next);
    return next.length;
  }

  async function rebuildPendingLogItems(room, reason = 'log-mode-change') {
    if (!room.pending) return;
    replacePendingLogItems(room);
    await syncPendingCarrier(room, reason);
  }

  async function syncEditedSlotIntoPending(room, slot, reason = 'slot-content-edit') {
    if (!room?.pending || !slot) return false;
    if (slot.id === 'logSummary') {
      await rebuildPendingLogItems(room, reason === 'slot-content-edit' ? 'log-content-edit' : reason);
      return true;
    }

    const items = Array.isArray(room.pending.items) ? room.pending.items : (room.pending.items = []);
    const idx = items.findIndex(i => i.slotId === slot.id && (Number(i.totalTurns || 0) === 0 || Number(i.usedTurns || 0) < Number(i.totalTurns || 0)));
    if (idx < 0) return false;

    if (!String(slot.content || '').trim()) {
      items.splice(idx, 1);
      await syncPendingCarrier(room, reason);
      return true;
    }

    // 본문을 수정해도 기존 유지턴 진행도는 리셋하지 않습니다.
    items[idx] = {
      ...items[idx],
      title: String(slot.title || slot.id || '메모').trim(),
      group: slot.group || items[idx].group || 'extra',
      content: String(slot.content || '').trim(),
    };
    await syncPendingCarrier(room, reason);
    return true;
  }

  async function setSlotEnabledDuringPending(room, slot, enabled) {
    if (!room.pending) {
      slot.enabled = enabled;
      await saveRoom(room);
      return;
    }
    const previousEnabled = !!slot.enabled;
    const previousItems = clonePendingItems(room.pending.items);
    slot.enabled = enabled;
    try {
      const items = Array.isArray(room.pending.items) ? room.pending.items : (room.pending.items = []);
      if (slot.id === 'logSummary') {
        replacePendingLogItems(room);
      } else {
        const idx = items.findIndex(i => i.slotId === slot.id);
        if (enabled) {
          const nextItem = slotToPendingItem(slot);
          if (idx >= 0) items[idx] = nextItem;
          else items.push(nextItem);
        } else if (idx >= 0) {
          items.splice(idx, 1);
        }
      }
      await syncPendingCarrier(room, enabled ? 'manual-add' : 'manual-remove');
      notify(enabled ? `‘${slot.title}’ 현재 주입에 추가 · ${retentionLabel(slot.retentionTurns)} 새로 시작` : `‘${slot.title}’ 현재 주입에서 제거`, 'success', 4200);
    } catch (e) {
      slot.enabled = previousEnabled;
      if (room.pending) room.pending.items = previousItems;
      await saveRoom(room);
      throw e;
    }
  }

  function newMessagesSinceLastScan(room, recentMessages) {
    const recent = (recentMessages || []).filter(m => ['user','assistant'].includes(messageRoleOf(m)));
    if (!recent.length) return [];
    const lastId = String(room.autoScanLastMessageId || '');
    let fresh;
    if (!lastId) fresh = recent.slice(0, Math.min(APP.autoScanMessageLimit, recent.length));
    else {
      const idx = recent.findIndex(m => String(messageIdOf(m) || '') === lastId);
      fresh = idx >= 0 ? recent.slice(0, idx) : recent.slice(0, Math.min(4, recent.length));
    }
    room.autoScanLastMessageId = String(messageIdOf(recent[0]) || room.autoScanLastMessageId || '');
    return fresh;
  }

  async function autoDetectCharacters(room, freshMessages) {
    if (!room.autoCharacterDetection) return { detected: [], added: 0, reset: 0 };
    const library = room.autoCharacterLibraryId ? await getCharacterLibrary(room.autoCharacterLibraryId) : null;
    const text = (freshMessages || []).map(m => stripAutomationNoise(messageTextOf(m))).filter(Boolean).join('\n');
    const chars = (room.slots || []).filter(s => s.group === 'character');
    const byKey = new Map(chars.map(s => [libraryItemKey(s), s]));
    const detected = [];
    let added = 0, reset = 0;

    for (const src of (library?.characters || [])) {
      const key = libraryItemKey(src);
      let slot = byKey.get(key);
      const terms = characterDetectionTerms(src);
      let matched = text ? terms.find(term => aliasAppears(text, term)) : null;
      // 📌 자동 고정은 '감지 이벤트'가 아니라 항상 유지되는 사용자 상태입니다.
      // 매 폴링마다 감지된 것으로 반환하면 토스트가 반복되고 모달이 재렌더링되어 스크롤이 위로 튀므로
      // 실제 최근 RP에서 이름/별칭이 잡힌 경우에만 detected에 포함합니다.
      if (!matched) continue;
      if (slot?.autoExcluded) continue;
      if (!slot) {
        slot = makeDynamicSlot('character', String(src.title || '캐릭터'));
        slot.aliases = Array.isArray(src.aliases) ? [...src.aliases] : [];
        slot.content = String(src.content || '');
        slot.retentionTurns = normalizeRetentionTurns(src.retentionTurns);
        slot.autoExcluded = false;
        slot.autoPinned = false;
        room.slots.push(slot);
        byKey.set(key, slot);
        added++;
      }
      if (!String(slot.content || '').trim()) slot.content = String(src.content || '');
      if (!Array.isArray(slot.aliases) || !slot.aliases.length) slot.aliases = Array.isArray(src.aliases) ? [...src.aliases] : [];
      slot.enabled = true;
      slot.lastAutoMatch = matched;
      slot.lastAutoDetectedAt = Date.now();
      detected.push({ slot, matched });

      if (room.pending) {
        const items = Array.isArray(room.pending.items) ? room.pending.items : (room.pending.items = []);
        const idx = items.findIndex(i => i.slotId === slot.id);
        const next = slotToPendingItem(slot);
        next.autoType = 'character';
        next.matchedAlias = matched;
        next.recallReason = matched === '사용자 고정' ? '사용자 고정' : `“${matched}” 감지`;
        if (idx < 0) items.push(next);
        else if (room.autoCharacterResetOnReappear || matched === '사용자 고정') { items[idx] = next; reset++; }
      }
    }

    // 설정집에 없는 현재 방 캐릭터라도 사용자가 📌 고정했다면 조용히 항상 유지합니다.
    // 고정 자체는 자동 '감지'로 취급하지 않아 반복 토스트/모달 재렌더링을 발생시키지 않습니다.
    for (const slot of (room.slots || []).filter(s => s.group === 'character' && s.autoPinned)) {
      if (detected.some(x => x.slot.id === slot.id)) continue;
      slot.enabled = true;
      slot.lastAutoMatch = '사용자 고정';
      if (room.pending) {
        const items = Array.isArray(room.pending.items) ? room.pending.items : (room.pending.items = []);
        const idx = items.findIndex(i => i.slotId === slot.id);
        const next = slotToPendingItem(slot);
        next.autoType = 'character';
        next.matchedAlias = '사용자 고정';
        next.recallReason = '사용자 고정';
        if (idx < 0) items.push(next); else items[idx] = next;
      }
    }
    normalizeRoomSlots(room);
    return { detected, added, reset };
  }

  function addAutoRelatedLogsToPending(room, contextText) {
    if (!room.pending || !room.autoLogRecallEnabled) return 0;
    const slot = (room.slots || []).find(s => s.id === 'logSummary');
    if (!slot?.enabled || !String(slot.content || '').trim()) return 0;
    const blocks = parseDatedLogBlocks(slot.content);
    if (!blocks.length) return 0;
    const excludedKeys = new Set((room.autoLogExcludedKeys || []).map(String));
    const pinnedKeys = new Set((room.autoLogPinnedKeys || []).map(String));
    const eligible = blocks.filter(b => !excludedKeys.has(b.key));
    const recentCount = Math.max(1, Math.min(2, Number(room.autoLogRecentBlocks) || APP.defaultRecentLogBlocks));
    const recent = selectRecentLogBlocks(eligible.filter(b => !pinnedKeys.has(b.key)), recentCount);
    const skip = new Set([...excludedKeys, ...pinnedKeys, ...recent.map(b => b.key)]);
    const relatedCount = Math.max(1, Math.min(4, Number(room.autoLogRelatedBlocks) || APP.defaultRelatedLogBlocks));
    const related = scoreRelatedLogBlocks(eligible, contextText, skip, room).slice(0, relatedCount);
    const items = Array.isArray(room.pending.items) ? room.pending.items : (room.pending.items = []);
    let added = 0;
    for (const scored of related) {
      const b = scored.block;
      const id = `auto-log:${b.key}`;
      const idx = items.findIndex(i => i.slotId === id);
      const next = { slotId: id, sourceSlotId: 'logSummary', autoType: 'related-log', sourceKey: b.key, title: `관련로그 ${b.titleText}`, group: 'log-auto', content: b.raw, totalTurns: normalizeRetentionTurns(slot.retentionTurns), usedTurns: 0, recallReason:relatedLogReason(scored), recallScore:scored.score, matchedTerms:[...(scored.matchedPhrases || []), ...(scored.matchedCoreTokens || []), ...(scored.matchedCharacterTerms || [])] };
      const activeNow = activePendingItems(room.pending);
      const baseWithoutSame = activeNow.filter(i => i.slotId !== id);
      const canFit = buildContextBlockFromItems([...baseWithoutSame, next]).length <= contextBudgetForCarrier(room, String(room.pending.originalText || '').length);
      if (!canFit) continue;
      if (idx < 0) { items.push(next); added++; }
      else if (Number(items[idx].usedTurns || 0) >= Number(items[idx].totalTurns || 0) && Number(items[idx].totalTurns || 0) !== 0) { items[idx] = next; added++; }
    }
    return added;
  }

  async function refreshAutomaticMemories(room, recentMessages, freshMessages = null) {
    const fresh = freshMessages || newMessagesSinceLastScan(room, recentMessages);
    if (!fresh.length) return { detected: [], added: 0, reset: 0, logAdded: 0, freshCount: 0 };
    const cleanFreshText = fresh.map(m => stripAutomationNoise(messageTextOf(m))).filter(Boolean).join('\n');
    if (cleanFreshText) room.autoRecallContextText = cleanFreshText.slice(-12000);
    const charResult = await autoDetectCharacters(room, fresh);
    const logAdded = addAutoRelatedLogsToPending(room, cleanFreshText);
    await saveRoom(room);
    if (room.chatId === state.currentChatId) state.currentRoom = room;
    return { ...charResult, logAdded, freshCount: fresh.length };
  }

  async function armInjection(room) {
    if (room.pending) throw new Error('이미 자동 유지 컨텍스트가 활성화되어 있습니다. 먼저 지금 해제해 주세요.');

    const recentForAuto = await fetchRecentMessages(apiChatIdOf(room), APP.autoScanMessageLimit);
    await refreshAutomaticMemories(room, recentForAuto, recentForAuto.filter(m => ['user','assistant'].includes(messageRoleOf(m))).slice(0, APP.autoScanMessageLimit));
    const firstAutoMessage = recentForAuto.find(m => ['user','assistant'].includes(messageRoleOf(m)));
    if (firstAutoMessage) room.autoScanLastMessageId = String(messageIdOf(firstAutoMessage) || room.autoScanLastMessageId || '');
    const recallText = recentForAuto.map(m => stripAutomationNoise(messageTextOf(m))).filter(Boolean).join('\n');
    room.autoRecallContextText = recallText.slice(-12000);
    const recent = await fetchRecentMessages(apiChatIdOf(room), 40);
    if (!recent.length) throw new Error('채팅 메시지를 찾지 못했습니다.');
    const newest = recent[0];
    if (messageRoleOf(newest) !== 'assistant') throw new Error('가장 최근 메시지가 AI 응답이 아닙니다. AI 생성이 끝난 뒤 주입을 시작해 주세요.');
    const latestAssistant = recent.find(m => messageRoleOf(m) === 'assistant');
    if (!latestAssistant) throw new Error('컨텍스트를 붙일 AI 메시지가 없습니다.');

    const targetId = messageIdOf(latestAssistant);
    if (!targetId) throw new Error('AI 메시지 ID를 찾지 못했습니다.');
    const rawOriginal = messageTextOf(latestAssistant);
    if (!rawOriginal) throw new Error('최근 AI 메시지 원문을 읽지 못했습니다.');
    const cleanOriginal = stripOurContextBlock(rawOriginal).text || rawOriginal;
    const items = snapshotSelectedItems(room, recallText, contextBudgetForCarrier(room, cleanOriginal.length));
    const contextBlock = buildContextBlockFromItems(items);
    if (!contextBlock) throw new Error('주입할 항목이 없습니다. 현재상태/캐릭터/기타 또는 날짜 로그의 직접 선택·자동 호출 설정을 확인해 주세요.');
    const injectedText = buildInjectedMessage(cleanOriginal, contextBlock);
    const maxChars = Number(room.maxChars) || APP.defaultMaxChars;
    if (injectedText.length > maxChars) throw new Error(`carrier 총 길이가 ${formatCount(injectedText.length)}자입니다. 설정 한도 ${formatCount(maxChars)}자를 넘습니다.`);

    const pending = {
      messageId: targetId,
      originalText: cleanOriginal,
      baselineAssistantId: targetId,
      sessionStartedAt: Date.now(), armedAt: Date.now(), carrierArmedAt: Date.now(),
      injectedChars: contextBlock.length, originalChars: cleanOriginal.length, carrierChars: injectedText.length,
      carrierRole: 'assistant', mode: 'append-hidden-html-comment-reanchor-per-item',
      verified: false, verifiedAt: null, serverChars: 0,
      logRecallRevision: APP.logRecallRevision,
      contextBlock, items,
    };

    savePendingBackup(room.chatId, pending);
    await patchMessage(apiChatIdOf(room), targetId, injectedText);
    const verification = await verifyInjectedCarrier(room, pending, injectedText);
    if (!verification.verified) {
      try {
        await restoreCarrierOnly(room, pending);
        clearPendingBackup(room.chatId);
      } catch (rollbackError) {
        // 롤백을 확인하지 못한 경우 복구 가능한 pending/백업을 반드시 남깁니다.
        room.pending = pending;
        savePendingBackup(room.chatId, pending);
        await saveRoom(room);
        throw new Error(`서버 주입 검증과 원문 롤백 확인에 실패했습니다. 복구 정보는 유지했습니다: ${rollbackError.message}`);
      }
      throw new Error('서버 재확인에서 숨김 컨텍스트를 확인하지 못해 AI 원문으로 안전 복원했습니다.');
    }
    pending.verified = true; pending.verifiedAt = Date.now(); pending.serverChars = verification.serverChars;
    savePendingBackup(room.chatId, pending);
    room.pending = pending; await saveRoom(room);
    if (room.chatId === state.currentChatId) state.currentRoom = room;
    sanitizeRenderedContextSoon();
    notify(`서버 주입 확인됨 ✓ · ${items.length}개 항목 독립 유지 시작`, 'success', 6500);
    renderModalIfOpen();
  }

  async function restorePending(room, reason = 'manual') {
    const p = room.pending;
    if (!p) return { restored: false, reason: 'none' };

    // 네트워크/PATCH 오류 때 finally에서 백업을 지우면 서버에는 숨김 블록이 남고
    // 복원 정보만 사라질 수 있습니다. 복원 또는 이미 정리됨이 확인된 뒤에만 해제합니다.
    const result = await restoreCarrierOnly(room, p);
    room.pending = null;
    clearPendingBackup(room.chatId);
    await saveRoom(room);

    if (room.chatId === state.currentChatId) {
      state.currentRoom = room;
      if (reason === 'manual') notifyInjectionEnded(room, 'manual');
      else if (reason === 'completed') notifyInjectionEnded(room, 'completed');
      else notify(`숨김 컨텍스트 원문 복원 완료 · ${reason === 'recovery' ? '복구 처리' : reason}`, 'success', 5000);
      renderModalIfOpen();
    }
    return result;
  }

  async function reanchorAfterResponse(room, latestAssistant) {
    const p = room.pending;
    if (!p) return;
    const newId = messageIdOf(latestAssistant);
    if (!newId || newId === p.messageId) return;
    await sleep(APP.reanchorDelayMs);

    // 이전 carrier 원문 복원
    await restoreCarrierOnly(room, p);

    // AI 응답 1회마다 기존 활성 항목을 독립적으로 1턴 차감합니다.
    const items = Array.isArray(p.items) ? p.items : [];
    for (const item of items) {
      const total = Number(item.totalTurns || 0);
      if (total !== 0 && Number(item.usedTurns || 0) < total) item.usedTurns = Number(item.usedTurns || 0) + 1;
    }

    // v0.8.9에서 이어진 pending은 최근로그가 저장소 뒤쪽 순서로 고정되어 있을 수 있습니다.
    // 새 carrier로 옮기기 전에 한 번만 현재 로그 저장소 기준으로 다시 선정합니다.
    if (Number(p.logRecallRevision || 0) < APP.logRecallRevision) replacePendingLogItems(room);

    // 방금 완료된 USER→AI 흐름에서 새 등장 캐릭터/관련 과거로그를 찾아 다음 응답용 컨텍스트에 추가합니다.
    const recentForAuto = await fetchRecentMessages(apiChatIdOf(room), APP.autoScanMessageLimit);
    const autoResult = await refreshAutomaticMemories(room, recentForAuto);
    if (room.pending) room.pending.items = p.items;
    const persistenceRepair = ensureDirectReleasePendingItems(room, p);
    if (persistenceRepair.added) console.info('[RP매니저] 직접 해제 항목 유지 복구:', persistenceRepair.added);
    let active = activePendingItems(p);
    if (!active.length) {
      room.pending = null; clearPendingBackup(room.chatId); await saveRoom(room);
      if (room.chatId === state.currentChatId) {
        state.currentRoom = room;
        notifyInjectionEnded(room, 'completed');
        renderModalIfOpen();
      }
      return;
    }

    const fresh = await fetchMessage(apiChatIdOf(room), newId) || latestAssistant;
    if (messageRoleOf(fresh) !== 'assistant') throw new Error('새 carrier가 AI 메시지가 아니어서 자동 유지를 중단합니다.');
    const newRaw = messageTextOf(fresh);
    if (!newRaw) throw new Error('새 AI 응답 원문을 읽지 못해 자동 유지를 중단합니다.');
    const stripped = stripOurContextBlock(newRaw);
    const newOriginal = stripped.found ? stripped.text : newRaw;
    const nonLogActive = active.filter(i => i.sourceSlotId !== 'logSummary' && i.group !== 'log-auto' && i.slotId !== 'logSummary');
    const logActive = active.filter(i => i.sourceSlotId === 'logSummary' || i.group === 'log-auto' || i.slotId === 'logSummary');
    if (logActive.length) {
      const fittedLogs = fitLogItemsToBudget(room, nonLogActive, logActive, contextBudgetForCarrier(room, newOriginal.length));
      const keepIds = new Set(fittedLogs.map(i => i.slotId));
      p.items = (p.items || []).filter(i => !(i.sourceSlotId === 'logSummary' || i.group === 'log-auto' || i.slotId === 'logSummary') || keepIds.has(i.slotId));
      active = [...nonLogActive, ...fittedLogs];
    }
    const contextBlock = buildContextBlockFromItems(active);
    if (!contextBlock) throw new Error('유지할 활성 컨텍스트가 없어 자동 유지를 중단합니다.');
    const nextInjected = buildInjectedMessage(newOriginal, contextBlock);
    const maxChars = Number(room.maxChars) || APP.defaultMaxChars;
    if (nextInjected.length > maxChars) {
      room.pending = null; clearPendingBackup(room.chatId); await saveRoom(room);
      throw new Error(`새 AI 응답 + 숨김 컨텍스트가 ${formatCount(nextInjected.length)}자로 주입 한도 ${formatCount(maxChars)}자를 넘어 자동 유지를 종료했습니다.`);
    }

    const nextPending = { ...p, messageId: newId, originalText: newOriginal, baselineAssistantId: newId,
      armedAt: Date.now(), carrierArmedAt: Date.now(), originalChars: newOriginal.length, carrierChars: nextInjected.length,
      verified: false, verifiedAt: null, serverChars: 0, logRecallRevision: APP.logRecallRevision, contextBlock, injectedChars: contextBlock.length, items: p.items };

    await patchMessage(apiChatIdOf(room), newId, nextInjected);
    const verification = await verifyInjectedCarrier(room, nextPending, nextInjected);
    if (!verification.verified) {
      try {
        await restoreCarrierOnly(room, nextPending);
        room.pending = null;
        clearPendingBackup(room.chatId);
        await saveRoom(room);
      } catch (rollbackError) {
        room.pending = nextPending;
        savePendingBackup(room.chatId, nextPending);
        await saveRoom(room);
        throw new Error(`새 carrier 검증과 원문 롤백 확인에 실패했습니다. 복구 정보는 유지했습니다: ${rollbackError.message}`);
      }
      throw new Error('새 carrier 서버 검증에 실패해 새 AI 원문으로 안전 복원하고 자동 유지를 종료했습니다.');
    }
    nextPending.verified = true; nextPending.verifiedAt = Date.now(); nextPending.serverChars = verification.serverChars;
    room.pending = nextPending; savePendingBackup(room.chatId, nextPending); await saveRoom(room);
    if (room.chatId === state.currentChatId) {
      state.currentRoom = room;
      sanitizeRenderedContextSoon();
      const autoBits = [];
      if (autoResult?.detected?.length) autoBits.push(`캐릭터 ${autoResult.detected.map(x => x.slot.title).join(', ')}`);
      if (autoResult?.logAdded) autoBits.push(`관련로그 ${autoResult.logAdded}개`);
      notify(`컨텍스트 자동 이동 완료 ✓ · ${active.length}개 항목 유지 중${autoBits.length ? ` · 자동호출 ${autoBits.join(' / ')}` : ''}`, 'success', autoBits.length ? 4800 : 3200);
      renderModalIfOpen();
    }
  }

  async function checkPendingRoom(room) {
    const p = room.pending;
    if (!p) return;

    const recent = await fetchRecentMessages(apiChatIdOf(room), 20);
    const latestAssistant = recent.find(m => messageRoleOf(m) === 'assistant');
    const latestAssistantId = messageIdOf(latestAssistant);
    if (!latestAssistantId) return;

    if (latestAssistantId === p.baselineAssistantId) {
      // v0.8.9에서 이어진 활성 주입은 새 버전에서 한 번만 로그 후보를 다시 계산합니다.
      // 따라서 업데이트 직후에도 사용자가 로그 칸을 다시 건드리지 않아도 최신 날짜가 반영됩니다.
      if (Number(p.logRecallRevision || 0) < APP.logRecallRevision) {
        replacePendingLogItems(room);
        await syncPendingCarrier(room, 'log-recall-upgrade');
        if (room.pending) {
          room.pending.logRecallRevision = APP.logRecallRevision;
          savePendingBackup(room.chatId, room.pending);
          await saveRoom(room);
        }
        return;
      }
      // 새로고침/렌더링 재구성 후에도 현재 carrier의 서버 주입이 살아있는지 가볍게 확인합니다.
      try {
        const carrier = await fetchMessage(apiChatIdOf(room), p.messageId);
        const carrierText = messageTextOf(carrier);
        if (carrierText && !stripOurContextBlock(carrierText).found) {
          const active = activePendingItems(p);
          const contextBlock = buildContextBlockFromItems(active);
          if (contextBlock) {
            // Refiner가 마커 없이 최신 교정문을 저장했을 수 있으므로 현재 서버 본문을 새 원문으로 채택합니다.
            p.originalText = carrierText;
            const injected = buildInjectedMessage(carrierText, contextBlock);
            await patchMessage(apiChatIdOf(room), p.messageId, injected);
            const reapplied = await verifyInjectedCarrier(room, p, injected, 3);
            if (!reapplied.verified) throw new Error('carrier 재주입 서버 검증 실패');
            p.contextBlock = contextBlock; p.carrierChars = injected.length; p.serverChars = reapplied.serverChars;
            p.verified = true; p.verifiedAt = Date.now();
            savePendingBackup(room.chatId, p); await saveRoom(room);
          }
        }
      } catch (e) { console.warn('[RP매니저] carrier verify/reapply failed:', room.chatId, e); }
      return;
    }

    if (latestAssistantId !== p.baselineAssistantId) {
      const beforeReanchor = { ...p, items: clonePendingItems(p.items) };
      try {
        await reanchorAfterResponse(room, latestAssistant);
      } catch (e) {
        console.warn('[RP매니저] reanchor failed:', room.chatId, e);
        // 실패 시 이전/새 carrier 양쪽이 깨끗한지 확인합니다. 네트워크 오류로 확인하지 못했다면
        // pending과 이중 백업을 남겨 다음 recoveryTick 또는 수동 해제로 재시도할 수 있게 합니다.
        let cleanupConfirmed = true;
        for (const messageId of [...new Set([beforeReanchor.messageId, latestAssistantId].filter(Boolean))]) {
          try { await restoreCarrierOnly(room, { ...beforeReanchor, messageId }); }
          catch (cleanupError) {
            cleanupConfirmed = false;
            console.warn('[RP매니저] reanchor cleanup not confirmed:', messageId, cleanupError);
          }
        }
        if (cleanupConfirmed) {
          room.pending = null;
          clearPendingBackup(room.chatId);
        } else {
          room.pending = room.pending || beforeReanchor;
          savePendingBackup(room.chatId, room.pending);
        }
        await saveRoom(room);
        if (room.chatId === state.currentChatId) {
          state.currentRoom = room;
          if (cleanupConfirmed) notifyInjectionEnded(room, 'error', e.message);
          else notify(`자동 이동 오류 · 복구 확인 전이라 주입 백업을 유지했습니다: ${e.message}`, 'error', 7500);
          renderModalIfOpen();
        }
      }
    }
  }

  async function recoveryTick() {
    if (state.recovering || !state.db) return;
    state.recovering = true;
    try {
      const rooms = await getAllRooms();
      for (const room of rooms) {
        try {
          normalizeRoomSlots(room);
          // 자동 캐릭터 감지는 주입 전에도 현재 방에서 동작해 다음 주입 준비를 해둡니다.
          if (!room.pending && (room.autoCharacterDetection || room.autoLogRecallEnabled) && room.chatId === state.currentChatId) {
            const lastScanAt = Number(state.idleAutoScanAt.get(room.chatId) || 0);
            if (Date.now() - lastScanAt < APP.idleAutoScanMs) continue;
            state.idleAutoScanAt.set(room.chatId, Date.now());
            const recent = await fetchRecentMessages(apiChatIdOf(room), APP.autoScanMessageLimit);
            const auto = await refreshAutomaticMemories(room, recent);
            if (auto.detected?.length && room.chatId === state.currentChatId) {
              notify(`캐릭터 자동 감지 · ${auto.detected.map(x => x.slot.title).join(', ')} 설정 활성화`, 'success', 3800);
              renderModalIfOpen();
            }
            continue;
          }
          if (!room.pending) continue;
          if (!Array.isArray(room.pending.items) || !room.pending.items.length) {
            const legacyTotal = room.pending.totalTurns == null ? APP.defaultRetentionTurns : normalizeRetentionTurns(room.pending.totalTurns);
            const legacyUsed = Number(room.pending.usedTurns || 0);
            room.pending.items = selectedSlots(room).map(slot => ({ slotId: slot.id, title: slot.title, group: slot.group, content: String(slot.content || ''), totalTurns: normalizeRetentionTurns(slot.retentionTurns ?? legacyTotal), usedTurns: legacyUsed }));
          }
          await checkPendingRoom(room);
        } catch (e) {
          console.warn('[RP매니저] pending check failed:', room.chatId, e);
        }
      }
    } finally {
      state.recovering = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Render-only sanitizer: 서버 raw는 유지하고 일반 채팅 화면에서만 RP 블록 숨김
  // ---------------------------------------------------------------------------

  function cleanupRenderedMarkerArtifacts(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    const removeNodes = []; let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === Node.COMMENT_NODE) {
        if (String(n.nodeValue || '').includes('RP_CONTEXT_MANAGER')) removeNodes.push(n);
        continue;
      }
      if (n.parentElement?.closest('#rpcm-overlay,#rpcm-toast-wrap,#rpcm-lib-dialog-backdrop')) continue;
      const before = n.nodeValue || '';
      // 🪽위시 RP Manager는 자기 마커가 포함된 흔적만 정리합니다.
      // 빈 <!----> 자체는 Crack/다른 확장이 사용할 수 있으므로 전역 삭제하지 않습니다.
      const beforeNorm = String(before || '');
      const after = /RP_CONTEXT_MANAGER(?:_START|_END)?/i.test(beforeNorm)
        ? beforeNorm.replace(/\?<!--?[^\n]*RP_CONTEXT_MANAGER[^\n]*>?/gi, '').replace(/^[\\\s]+$/g, m => m.includes('\\') ? m.replace(/\\/g, '') : m)
        : beforeNorm;
      if (after !== before) n.nodeValue = after;
    }
    removeNodes.forEach(x => x.remove());
  }

  function sanitizeOneRenderedBlock(startNode) {
    if (!startNode || startNode.nodeType !== Node.TEXT_NODE) return false;
    if (startNode.parentElement?.closest('#rpcm-overlay,#rpcm-toast-wrap,#rpcm-lib-dialog-backdrop')) return false;
    let root = startNode.parentElement;
    for (let i = 0; root && i < 12; i++, root = root.parentElement) {
      if (root.id === 'rpcm-overlay' || root.id === 'rpcm-toast-wrap' || root.id === 'rpcm-lib-dialog-backdrop') return false;
      const text = root.textContent || '';
      if (!text.includes('RP_CONTEXT_MANAGER_END')) continue;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = []; let joined = ''; let n;
      while ((n = walker.nextNode())) {
        if (n.parentElement?.closest('#rpcm-overlay,#rpcm-toast-wrap,#rpcm-lib-dialog-backdrop')) continue;
        nodes.push({ node: n, start: joined.length, end: joined.length + n.nodeValue.length });
        joined += n.nodeValue;
      }
      let start = joined.indexOf('<!--RP_CONTEXT_MANAGER_START');
      if (start < 0) start = joined.indexOf('RP_CONTEXT_MANAGER_START');
      let end = joined.indexOf('RP_CONTEXT_MANAGER_END-->', start >= 0 ? start : 0);
      let endLen = 'RP_CONTEXT_MANAGER_END-->'.length;
      if (end < 0) { end = joined.indexOf('RP_CONTEXT_MANAGER_END', start >= 0 ? start : 0); endLen = 'RP_CONTEXT_MANAGER_END'.length; }
      if (start < 0 || end < 0) continue;
      // Markdown renderer가 HTML 주석 앞의 escape 백슬래시를 따로 남기는 경우까지 같이 제거합니다.
      if (start > 0 && joined[start - 1] === '\\') start--;
      const cutEnd = end + endLen;

      for (const part of nodes) {
        if (part.end <= start || part.start >= cutEnd) continue;
        const localStart = Math.max(0, start - part.start);
        const localEnd = Math.min(part.node.nodeValue.length, cutEnd - part.start);
        part.node.nodeValue = part.node.nodeValue.slice(0, localStart) + part.node.nodeValue.slice(localEnd);
      }
      cleanupRenderedMarkerArtifacts(root);
      return true;
    }
    return false;
  }

  function sanitizeRenderedContextBlocks(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const starts = []; let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('#rpcm-overlay,#rpcm-toast-wrap,#rpcm-lib-dialog-backdrop')) continue;
      const v = node.nodeValue || '';
      if (v.includes('RP_CONTEXT_MANAGER_START')) starts.push(node);
    }
    for (const start of starts) sanitizeOneRenderedBlock(start);
  }

  function sanitizeRenderedContextSoon() {
    clearTimeout(state.domSanitizeTimer);
    state.domSanitizeTimer = setTimeout(() => sanitizeRenderedContextBlocks(document.body || document.documentElement || document), 0);
  }

  function startRenderedContextObserver() {
    if (state.domObserver) return;
    const target = document.documentElement || document;
    state.domObserver = new MutationObserver((mutations) => {
      if (state.domSanitizing) return;
      let relevant = false;
      for (const m of mutations) {
        const probe = m.type === 'characterData' ? m.target?.parentElement : m.target;
        const text = probe?.textContent || '';
        if (text.includes('RP_CONTEXT_MANAGER_START') || text.includes('RP_CONTEXT_MANAGER_END')) { relevant = true; break; }
        for (const added of (m.addedNodes || [])) {
          const addedText = added?.textContent || added?.nodeValue || '';
          if (addedText.includes('RP_CONTEXT_MANAGER_START') || addedText.includes('RP_CONTEXT_MANAGER_END')) { relevant = true; break; }
        }
        if (relevant) break;
      }
      if (!relevant) return;
      state.domSanitizing = true;
      try {
        // MutationObserver 콜백은 렌더 페인트 전에 실행되므로 UI 초기화와 무관하게 즉시 제거합니다.
        sanitizeRenderedContextBlocks(document.body || document.documentElement || document);
      } finally {
        state.domSanitizing = false;
      }
    });
    state.domObserver.observe(target, { childList: true, subtree: true, characterData: true });
    sanitizeRenderedContextBlocks(document.body || document.documentElement || document);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function addStyles() {
    GM_addStyle(`
      #rpcm-fab{position:relative!important;z-index:20!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;min-width:0!important;height:34px!important;min-height:34px!important;padding:0 13px!important;border-radius:9px!important;border:1px solid #f472b6!important;background:rgba(244,114,182,.14)!important;color:#f9a8d4!important;box-shadow:none!important;font-family:inherit!important;font-size:13px!important;font-weight:700!important;line-height:1!important;white-space:nowrap!important;cursor:pointer!important;user-select:none!important;transition:background .16s,border-color .16s,color .16s!important;pointer-events:auto!important}
      #rpcm-fab:hover{transform:none!important;background:rgba(244,114,182,.23)!important;border-color:#fb7185!important;color:#fbcfe8!important}
      #rpcm-fab.rpcm-armed{background:rgba(244,114,182,.26)!important;border-color:#fb7185!important;color:#fff!important;box-shadow:0 0 0 1px rgba(251,113,133,.18)!important}
      #rpcm-fab .rpcm-dot{position:relative!important;right:auto!important;top:auto!important;width:7px!important;height:7px!important;border-radius:50%!important;background:#f9a8d4!important;border:0!important;flex:0 0 auto!important}
      #rpcm-fab.rpcm-armed .rpcm-dot{background:#22c55e!important;box-shadow:0 0 0 2px rgba(34,197,94,.16)!important}
      #rpcm-fab[hidden]{display:none!important}
      #rpcm-fab.rpcm-fallback{position:fixed!important;right:12px!important;z-index:2147483645!important;height:34px!important;margin:0!important;border-radius:999px!important;box-shadow:0 4px 14px rgba(0,0,0,.35)!important;backdrop-filter:blur(8px)!important}
      @media (prefers-color-scheme:light){#rpcm-fab{background:#fff1f7!important;color:#b84f7e!important;border-color:#df6298!important}#rpcm-fab:hover{background:#ffe4ef!important;color:#9f416e!important}}
      #rpcm-overlay{position:fixed;inset:0;z-index:9998;background:transparent;display:block;padding:0;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Pretendard",sans-serif}
      #rpcm-modal{width:100%;max-height:calc(100vh - 140px);background:#181818;color:#eee;border:1px solid #3a3a3a;border-radius:16px;box-shadow:0 25px 80px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden}
      .rpcm-header{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #303030;background:#1d1d1d;cursor:grab;user-select:none}.rpcm-header.rpcm-dragging{cursor:grabbing}.rpcm-header button,.rpcm-header input{cursor:pointer}

      .rpcm-title{font-size:17px;font-weight:800}.rpcm-sub{font-size:12px;color:#999;margin-top:2px}.rpcm-spacer{flex:1}.rpcm-iconbtn{border:1px solid #3b3b3b;background:#262626;color:#ddd;border-radius:9px;padding:8px 10px;cursor:pointer}.rpcm-iconbtn:hover{background:#333}
      .rpcm-body{padding:16px 18px 110px;overflow-y:auto;min-height:0}
      .rpcm-summary{background:#1d1d1d;border:1px solid #303030;border-radius:11px;padding:12px 14px;margin-bottom:14px}
      .rpcm-summary-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.rpcm-summary-label{font-size:10px;font-weight:750;color:#777;letter-spacing:.02em}.rpcm-summary-main{display:flex;align-items:baseline;gap:8px;margin-top:3px}.rpcm-summary-main strong{color:#f3f3f3;font-size:18px;line-height:1.2}.rpcm-summary-count{font-size:11px;color:#888}.rpcm-summary-side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.rpcm-summary-status{font-size:10px;font-weight:800;padding:3px 7px;border-radius:6px;background:#262626}.rpcm-limit{font-size:10px;color:#777;white-space:nowrap}.rpcm-limit input{display:none}
      .rpcm-gauge{height:4px;background:#2c2c2c;border-radius:999px;overflow:hidden;margin-top:10px}.rpcm-gauge>span{display:block;height:100%;background:#4b9b68;transition:.2s}.rpcm-gauge.warn>span{background:#c9933c}.rpcm-gauge.bad>span{background:#c85c5c}
      .rpcm-slot{border:1px solid #333;background:#1f1f1f;border-radius:11px;margin-bottom:9px;overflow:hidden}
      .rpcm-slot summary{list-style:none;display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer;user-select:none}.rpcm-slot summary::-webkit-details-marker{display:none}.rpcm-slot summary:hover{background:#252525}
      #rpcm-modal input[type=checkbox],#rpcm-lib-dialog-backdrop input[type=checkbox],#rpcm-log-dialog-backdrop input[type=checkbox],#rpcm-dup-dialog-backdrop input[type=radio]{accent-color:#df6298}
      .rpcm-enable{width:18px;height:18px;accent-color:#df6298}.rpcm-slot-name{font-size:13px;font-weight:750;flex:1}.rpcm-slot-count{font-size:11px;color:#888}.rpcm-chevron{font-size:12px;color:#666}.rpcm-slot[open] .rpcm-chevron{transform:rotate(90deg)}
      .rpcm-edit{padding:0 12px 12px}.rpcm-title-input{width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #3b3b3b;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:8px}.rpcm-textarea{width:100%;box-sizing:border-box;min-height:160px;resize:vertical;background:#101010;color:#e6e6e6;border:1px solid #3b3b3b;border-radius:8px;padding:11px;font-size:13px;line-height:1.55;outline:none}.rpcm-textarea:focus,.rpcm-title-input:focus{border-color:#df6298;box-shadow:0 0 0 2px rgba(223,98,152,.16)}
      .rpcm-pending{display:flex;gap:10px;align-items:center;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:11px;padding:11px 12px;margin-bottom:12px;color:#fbbf24;font-size:12px}.rpcm-pending strong{color:#fff}.rpcm-pending .rpcm-spacer{flex:1}
      .rpcm-footer{position:absolute;bottom:0;left:0;right:0;display:flex;gap:9px;align-items:center;padding:12px 18px;background:rgba(24,24,24,.96);border-top:1px solid #333;backdrop-filter:blur(8px)}
      #rpcm-modal-wrap{position:fixed;top:64px;right:16px;display:flex;flex-direction:column;max-height:calc(100vh - 140px);width:min(820px,calc(100vw - 32px));pointer-events:auto}
      .rpcm-btn{border:none;border-radius:9px;padding:10px 14px;font-weight:750;font-size:13px;cursor:pointer;white-space:nowrap}.rpcm-btn.primary{background:#df6298;color:#fff}.rpcm-btn.primary:hover{background:#d6538e}.rpcm-btn.secondary{background:#2a2a2a;color:#ddd;border:1px solid #3b3b3b}.rpcm-btn.secondary:hover{background:#353535}.rpcm-btn.warn{background:#92400e;color:#fff}.rpcm-btn.danger{background:#7f1d1d;color:#fff}.rpcm-btn:disabled{opacity:.4;cursor:not-allowed}.rpcm-footnote{font-size:11px;color:#777;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .rpcm-section{margin:16px 0 8px}.rpcm-section-head{display:flex;align-items:center;gap:8px;margin:0 2px 8px}.rpcm-section-head.rpcm-character-head{display:block}.rpcm-section-title{font-size:13px;font-weight:850;color:#d7d7d7}.rpcm-section-desc{font-size:11px;color:#747474;line-height:1.55}.rpcm-charlib-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-start;margin-top:10px}.rpcm-charlib-actions .rpcm-add-btn{margin-left:0}.rpcm-add-btn{margin-left:auto;border:1px solid #3b3b3b;background:#242424;color:#ccc;border-radius:8px;padding:7px 10px;font-size:11px;font-weight:700;cursor:pointer}.rpcm-add-btn:hover{background:#303030;color:#fff}.rpcm-delete-btn{border:1px solid #5a2a2a;background:#2a1818;color:#fca5a5;border-radius:7px;padding:6px 9px;font-size:11px;cursor:pointer;margin-left:8px}.rpcm-delete-btn:hover{background:#3a1b1b}.rpcm-fixed-note{font-size:11px;color:#777;margin:-2px 0 8px;line-height:1.55}.rpcm-guide-toggle{border:1px solid #6b3a55;background:#2a1a24;color:#e5a3c3;border-radius:6px;padding:3px 7px;font-size:9px;font-weight:750;cursor:pointer}.rpcm-guide-toggle:hover,.rpcm-guide-toggle.is-open{color:#fce7f3;background:#3a2130;border-color:#be5f91}.rpcm-guide-panel{margin:0 0 11px;border:1px solid #5d3149;border-left:3px solid #df6298;border-radius:8px;background:#20131b;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(223,98,152,.04)}.rpcm-guide-panel[hidden]{display:none!important}.rpcm-guide-head{display:flex;align-items:center;gap:8px;padding:8px 9px;border-bottom:1px solid #4a293b;background:#291823;color:#d8a0bc;font-size:10px}.rpcm-guide-head span{flex:1}.rpcm-guide-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;padding:0;border:1px solid #71405a;border-radius:6px;background:#321d29;color:#efb5d1;cursor:pointer}.rpcm-guide-icon:hover{background:#452638;color:#fff1f7;border-color:#c46497}.rpcm-guide-icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.rpcm-guide-reset{height:26px;padding:0 8px;border:1px solid #71405a;border-radius:6px;background:#321d29;color:#e6abc8;font-size:9px;font-weight:700;cursor:pointer}.rpcm-guide-reset:hover{background:#452638;color:#fce7f3;border-color:#c46497}.rpcm-guide-textarea{display:block;width:100%;box-sizing:border-box;min-height:260px;max-height:420px;resize:vertical;border:0;background:#170f14;color:#eadbe3;padding:11px 12px;font:11px/1.58 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;outline:none;caret-color:#df6298}.rpcm-guide-textarea::selection{background:#7a3159;color:#fff}.rpcm-slot-options{display:flex;align-items:center;gap:8px;margin:0 0 8px;color:#888;font-size:11px}.rpcm-slot-options select{height:30px;border:1px solid #444;border-radius:7px;background:#232323;color:#eee;padding:0 8px;font:inherit}.rpcm-auto-panel{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0 10px;padding:10px 12px;border:1px solid #333;border-radius:10px;background:#191919;color:#aaa;font-size:11px}
.rpcm-auto-note{flex-basis:100%;font-size:11px;line-height:1.55;color:#8d8d93;padding-top:2px}.rpcm-auto-note b{color:#b8b8bf;font-weight:650}.rpcm-auto-panel label{display:flex;gap:6px;align-items:center}.rpcm-auto-panel input[type=checkbox]{accent-color:#df6298}.rpcm-auto-panel select{height:30px;border:1px solid #444;border-radius:7px;background:#232323;color:#eee;padding:0 8px;font:inherit;max-width:260px}.rpcm-alias-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;margin:0 0 8px}.rpcm-alias-input{height:32px;border:1px solid #404040;border-radius:7px;background:#1e1e1e;color:#ddd;padding:0 9px;font:11px/1.2 inherit;min-width:0}.rpcm-auto-exclude,.rpcm-auto-pin{display:flex;align-items:center;gap:5px;color:#888;font-size:10px;white-space:nowrap}.rpcm-auto-exclude input,.rpcm-auto-pin input{accent-color:#df6298}.rpcm-auto-terms{font-size:10px;color:#777;line-height:1.5;margin:-2px 0 8px;padding:6px 8px;border-left:2px solid #3b3b3b;background:#191919}.rpcm-auto-terms strong{color:#aaa}.rpcm-slot-remain{font-size:10px;font-weight:800;color:#fbbf24;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);padding:3px 6px;border-radius:6px}.rpcm-empty{border:1px dashed #343434;border-radius:10px;color:#666;font-size:12px;padding:14px;text-align:center;margin-bottom:9px}.rpcm-lib-dialog-backdrop{}#rpcm-lib-dialog-backdrop{position:fixed;inset:0;z-index:1000004;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:18px}.rpcm-lib-dialog{width:min(520px,94vw);max-height:min(720px,88vh);display:flex;flex-direction:column;background:#171717;border:1px solid #3b3b3b;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.55);color:#ddd;overflow:hidden}.rpcm-lib-dialog-head{display:flex;gap:12px;align-items:flex-start;padding:16px;border-bottom:1px solid #2d2d2d}.rpcm-lib-dialog-head>div:first-child{flex:1;min-width:0}.rpcm-lib-dialog-title{font-size:15px;font-weight:850;color:#f1f1f1}.rpcm-lib-dialog-desc{font-size:11px;color:#888;line-height:1.55;margin-top:4px}.rpcm-lib-close{border:0;background:transparent;color:#888;font-size:18px;cursor:pointer}.rpcm-lib-toolbar{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid #292929}.rpcm-lib-small{border:1px solid #3b3b3b;background:#222;color:#bbb;border-radius:7px;padding:6px 8px;font-size:11px;cursor:pointer}.rpcm-lib-selected{margin-left:auto;font-size:11px;color:#999}.rpcm-lib-list{overflow:auto;padding:8px 12px;min-height:80px}.rpcm-lib-row{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:9px;cursor:pointer}.rpcm-lib-row:hover{background:#222}.rpcm-lib-row input{margin-top:2px;accent-color:#df6298}.rpcm-lib-row span{display:flex;flex-direction:column;gap:3px;min-width:0}.rpcm-lib-row strong{font-size:12px;color:#e8e8e8}.rpcm-lib-row small{font-size:10px;color:#777}.rpcm-library-row{align-items:center;padding:6px 8px}.rpcm-lib-row-main{display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0;padding:4px 2px;cursor:pointer}.rpcm-lib-row-main input{margin-top:2px}.rpcm-lib-row-main span{flex:1}.rpcm-lib-rename-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:30px;height:30px;border:1px solid transparent;border-radius:7px;background:transparent;color:#7d7d82;cursor:pointer;transition:background .16s,border-color .16s,color .16s}.rpcm-lib-rename-icon:hover{background:rgba(223,98,152,.10);border-color:rgba(223,98,152,.30);color:#df6298}.rpcm-lib-rename-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.rpcm-lib-preserve{display:flex;align-items:flex-start;gap:8px;margin:0 14px 8px;padding:10px;border:1px solid #333;border-radius:9px;background:#1d1d1d;font-size:11px;color:#aaa;line-height:1.45}.rpcm-lib-preserve input{margin-top:2px;accent-color:#df6298}.rpcm-lib-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid #2d2d2d}
      .rpcm-tools{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0 2px}.rpcm-mini{font-size:11px;padding:7px 9px;border-radius:7px;border:1px solid #3b3b3b;background:#232323;color:#aaa;cursor:pointer}.rpcm-mini:hover{color:#fff;background:#303030}
      .rpcm-breakdown{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px;row-gap:0;margin-top:10px;border-top:1px solid #292929}.rpcm-breakdown-chip{display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;border-bottom:1px solid #292929;background:transparent;color:#777;border-radius:0;padding:6px 1px;font-size:10px}.rpcm-breakdown-chip strong{color:#bdbdbd;font-weight:700}.rpcm-auto-active{margin:0 0 12px;padding:10px 12px;border:1px solid #303030;border-radius:10px;background:#191919}.rpcm-auto-active-title{font-size:11px;font-weight:800;color:#bbb;margin-bottom:6px}.rpcm-auto-active-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;align-items:center;padding:5px 0;border-top:1px solid #252525;font-size:10px;color:#888}.rpcm-auto-active-row:first-of-type{border-top:0}.rpcm-auto-badge{border:1px solid #3c3c3c;border-radius:999px;padding:2px 6px;color:#bbb}.rpcm-auto-active-row strong{display:block;color:#ddd;font-size:11px}.rpcm-auto-active-meta{display:flex;align-items:center;justify-content:flex-end;gap:6px;white-space:nowrap}.rpcm-auto-inline-toggle{width:25px;height:24px;padding:0;border:1px solid #3b3b3b;border-radius:6px;background:#222;color:#aaa;cursor:pointer;font-size:11px;line-height:1}.rpcm-auto-inline-toggle:hover{border-color:#70405a;background:#2b1d25;color:#e9abc8}.rpcm-auto-inline-content{grid-column:1/-1;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;margin:4px 0 3px;padding:9px 10px;border:1px solid #303030;border-left:2px solid #b55a84;border-radius:7px;background:#101010;color:#aaa;font:10px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.rpcm-auto-inline-content[hidden]{display:none!important}.rpcm-warnings{margin:0 0 12px;padding:9px 11px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);border-radius:9px;color:#fbbf24;font-size:10px;line-height:1.55}.rpcm-warning-action{display:inline-flex;align-items:center;margin-top:7px;padding:5px 8px;border:1px solid rgba(245,158,11,.45);border-radius:6px;background:rgba(245,158,11,.10);color:#fbbf24;font-size:10px;font-weight:750;cursor:pointer}.rpcm-warning-action:hover{background:rgba(245,158,11,.18);color:#fde68a}.rpcm-save-status{font-size:10px;white-space:nowrap}.rpcm-save-status.saved{color:#6b9f7b}.rpcm-save-status.saving{color:#d1a64b}.rpcm-save-status.error{color:#ef7777}#rpcm-log-dialog-backdrop{position:fixed;inset:0;z-index:1000005;background:rgba(0,0,0,.64);display:flex;align-items:center;justify-content:center;padding:18px}.rpcm-log-dialog{width:min(720px,95vw);max-height:min(820px,90vh);display:flex;flex-direction:column;background:#171717;border:1px solid #3b3b3b;border-radius:14px;overflow:hidden;color:#ddd}.rpcm-log-list{overflow:auto;padding:10px 12px}.rpcm-log-row{padding:10px 11px;border:1px solid #303030;border-radius:9px;background:#1d1d1d;margin-bottom:8px}.rpcm-log-row-head{display:flex;gap:8px;align-items:center}.rpcm-log-row-head strong{flex:1;font-size:12px}.rpcm-log-row-head span,.rpcm-log-row-reason{font-size:10px;color:#777}.rpcm-log-row-reason{margin-top:3px}.rpcm-log-row-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:7px;font-size:10px;color:#aaa}.rpcm-log-row-controls label{display:flex;align-items:center;gap:4px}.rpcm-log-content{white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;background:#101010;border:1px solid #2d2d2d;border-radius:7px;padding:9px;margin:8px 0 0;color:#aaa;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.rpcm-log-help{padding:9px 14px;border-bottom:1px solid #292929;background:#1b1719;color:#9c9096;font-size:10px;line-height:1.55}.rpcm-log-help b{color:#d8b2c4}.rpcm-log-year,.rpcm-log-month{border:1px solid #2f2f2f;border-radius:10px;background:#191919;margin-bottom:9px;overflow:hidden}.rpcm-log-year>summary,.rpcm-log-month>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:10px 11px;background:#1d1d1d;color:#ddd}.rpcm-log-year>summary::-webkit-details-marker,.rpcm-log-month>summary::-webkit-details-marker{display:none}.rpcm-log-year>summary:before,.rpcm-log-month>summary:before{content:"▸";color:#8b7c83;font-size:10px}.rpcm-log-year[open]>summary:before,.rpcm-log-month[open]>summary:before{content:"▾"}.rpcm-log-year>summary strong,.rpcm-log-month>summary strong{flex:1}.rpcm-log-year>summary span,.rpcm-log-month>summary span{color:#777;font-size:10px}.rpcm-log-month{margin:8px;border-color:#2a2a2a}.rpcm-log-month>summary{padding:8px 9px;background:#1b1b1b}.rpcm-log-groupbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid #252525;border-bottom:1px solid #252525;background:#181518;color:#9b9095;font-size:10px}.rpcm-log-groupbar label{display:flex;align-items:center;gap:4px;cursor:pointer}.rpcm-log-groupbar input,.rpcm-log-manual{accent-color:#df6298}.rpcm-log-month .rpcm-log-row{margin:7px 8px;background:#1b1b1b}.rpcm-log-dialog .rpcm-spacer{flex:1}#rpcm-dup-dialog-backdrop{position:fixed;inset:0;z-index:1000006;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:18px}.rpcm-dup-dialog{width:min(860px,95vw)}.rpcm-dup-list{padding:12px 14px}.rpcm-dup-group{border:1px solid #3b3326;border-radius:10px;background:#1b1916;margin-bottom:12px;overflow:hidden}.rpcm-dup-group-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #332d24;background:#211d18}.rpcm-dup-group-head strong{color:#f0cf8a;font-size:12px}.rpcm-dup-group-head span{color:#8e8270;font-size:10px}.rpcm-dup-choice{margin:9px;border:1px solid #303030;border-radius:9px;background:#1b1b1b;overflow:hidden;transition:border-color .15s,box-shadow .15s}.rpcm-dup-choice.is-selected{border-color:#b75d86;box-shadow:0 0 0 1px rgba(223,98,152,.12)}.rpcm-dup-choice-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#202020;cursor:pointer}.rpcm-dup-choice-head strong{flex:1;color:#ddd;font-size:11px}.rpcm-dup-choice-head span{color:#777;font-size:10px}.rpcm-dup-editor{display:block;width:100%;min-height:130px;max-height:260px;resize:vertical;box-sizing:border-box;border:0;border-top:1px solid #2b2b2b;background:#101010;color:#c7c7c7;padding:10px 11px;outline:none;font:10px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.rpcm-dup-editor:focus{box-shadow:inset 0 0 0 1px rgba(223,98,152,.42)}
      .rpcm-retention{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 12px;margin:10px 0 0;border:1px solid #343434;border-radius:10px;background:#191919;color:#bbb;font-size:12px}.rpcm-retention strong{color:#eee}.rpcm-retention select{height:32px;border:1px solid #444;border-radius:8px;background:#242424;color:#f2f2f2;padding:0 9px;font:inherit;outline:none}.rpcm-retention .rpcm-retention-help{color:#888;font-size:11px}
      #rpcm-preview{white-space:pre-wrap;word-break:break-word;background:#0d0d0d;border:1px solid #333;border-radius:10px;padding:13px;font-size:12px;line-height:1.55;color:#bbb;max-height:330px;overflow:auto;margin-top:12px;display:none}
      #rpcm-raw-viewer{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.56);display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}.rpcm-raw-card{width:min(920px,94vw);height:min(760px,88vh);display:flex;flex-direction:column;background:#161616;border:1px solid #444;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.65);overflow:hidden}.rpcm-raw-head{display:flex;align-items:center;gap:12px;padding:13px 15px;border-bottom:1px solid #333}.rpcm-raw-head>div:first-child{flex:1;font-size:12px;color:#999}.rpcm-raw-head strong{display:block;color:#f5f5f5;font-size:14px;margin-bottom:3px}.rpcm-raw-note{padding:10px 15px;background:#202020;color:#aaa;font-size:11px;line-height:1.45;border-bottom:1px solid #303030}.rpcm-raw-text{flex:1;min-height:0;resize:none;background:#0c0c0c;color:#ddd;border:0;outline:0;padding:15px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #rpcm-toast-wrap{position:fixed;z-index:9999;top:18px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:7px;pointer-events:none}.rpcm-toast{background:#202020;color:#eee;border:1px solid #3c3c3c;border-radius:9px;padding:10px 14px;box-shadow:0 8px 26px rgba(0,0,0,.38);font-size:12px;opacity:0;transform:translateY(-8px);transition:.22s;max-width:min(580px,90vw)}.rpcm-toast.show{opacity:1;transform:translateY(0)}.rpcm-toast.success{border-color:#166534}.rpcm-toast.error{border-color:#991b1b}.rpcm-toast.warn{border-color:#92400e}
      @media(max-width:680px){#rpcm-overlay{padding:0;pointer-events:none}#rpcm-modal-wrap{top:0;right:0;width:100vw;max-height:100vh;height:100vh;pointer-events:auto}#rpcm-modal{width:100vw;max-height:100vh;height:100vh;border-radius:0}.rpcm-body{padding:12px 12px 120px}.rpcm-header{padding:12px}.rpcm-summary-head{display:block}.rpcm-summary-side{justify-content:flex-start;margin-top:7px}.rpcm-breakdown{grid-template-columns:1fr}.rpcm-footer{padding:10px 12px;flex-wrap:wrap}.rpcm-footnote{width:100%;flex-basis:100%}.rpcm-btn{flex:1}}
    `);
  }

  function findTopActionButton(label) {
    const wanted = String(label || '').trim().toLowerCase();
    const candidates = [...document.querySelectorAll('button, [role="button"]')];
    return candidates.find(el => {
      if (el.id === 'rpcm-fab' || el.closest('#rpcm-overlay')) return false;
      const t = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return t === wanted;
    }) || null;
  }

  function isElementVisible(el) {
    if (!el?.getBoundingClientRect || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function visibleButtonLikes(root = document) {
    const scope = root?.querySelectorAll ? root : document;
    return [...scope.querySelectorAll('button,a,[role="button"]')]
      .filter(el => el.id !== 'rpcm-fab' && !el.closest('#rpcm-overlay') && isElementVisible(el));
  }

  function inlineAnchorTarget(anchor) {
    if (!anchor?.parentElement || !isElementVisible(anchor)) return null;
    if (anchor.parentElement === document.body || getComputedStyle(anchor).position === 'fixed') return null;
    return { host: anchor.parentElement, before: anchor.nextSibling, kind: 'named-action' };
  }

  function findLegacyBannerTarget() {
    const isStory = /^\/stories\//.test(location.pathname) || /^\/u\//.test(location.pathname);
    const panels = document.getElementsByClassName(isStory ? 'css-1c5w7et' : 'css-l8r172');
    if (!panels?.length) return null;
    try {
      const divs = panels[0].childNodes[panels.length - 1]?.getElementsByTagName?.('div');
      if (!divs?.length) return null;
      const list = divs[0].children?.[0]?.children;
      const top = list?.[list.length - 1];
      return top ? { host: top, before: top.childNodes[0] || null, kind: 'legacy-banner' } : null;
    } catch (_) { return null; }
  }

  function findModernHeaderTarget() {
    const minLeft = Math.max(260, Math.floor(window.innerWidth * .35));
    const controls = visibleButtonLikes(document)
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 40 && r.top <= 135 && r.left >= minLeft && r.right <= window.innerWidth + 8;
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    for (const control of controls) {
      let node = control.parentElement;
      while (node && node !== document.body) {
        const r = node.getBoundingClientRect();
        if (r.top >= 32 && r.top <= 140 && r.height >= 28 && r.height <= 76 &&
            r.width > 28 && r.width <= Math.min(720, window.innerWidth * .62) && r.right >= window.innerWidth * .52) {
          const children = visibleButtonLikes(node)
            .filter(child => child.getBoundingClientRect().top >= 32 && child.getBoundingClientRect().top <= 140)
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          if (children.length) return { host: node, before: children[0], kind: 'modern-header' };
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  function findComposerToolbarTarget() {
    const editors = [...document.querySelectorAll('[contenteditable="true"],.ProseMirror')]
      .filter(isElementVisible)
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    for (const editor of editors) {
      let node = editor.parentElement;
      while (node && node !== document.body) {
        const r = node.getBoundingClientRect();
        if (r.bottom >= window.innerHeight - 180 && r.height <= 240 && r.width >= 280) {
          const controls = visibleButtonLikes(node)
            .filter(child => child.getBoundingClientRect().top >= editor.getBoundingClientRect().bottom - 4)
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          if (controls.length) return { host: controls[0].parentElement || node, before: controls[0], kind: 'composer-toolbar' };
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  function findManagerButtonTarget() {
    const loreEntry = document.getElementById('lore-inj-entry-button') || document.querySelector('[data-lore-inj-entry="true"]');
    return inlineAnchorTarget(loreEntry) ||
      inlineAnchorTarget(findTopActionButton('Lore')) ||
      inlineAnchorTarget(findTopActionButton('기억 삽입')) ||
      findLegacyBannerTarget() ||
      findModernHeaderTarget() ||
      findComposerToolbarTarget();
  }

  function createManagerButton() {
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'rpcm-fab';
    fab.innerHTML = `Manager<span class="rpcm-dot" aria-hidden="true"></span>`;
    fab.onmousedown = e => e.stopPropagation();
    fab.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      openModal().catch(err => notify(err.message, 'error'));
    };
    return fab;
  }

  function mountManagerFallback(fab) {
    if (!document.body) return false;
    fab.classList.add('rpcm-fallback');
    const lore = document.getElementById('lore-inj-entry-button');
    let bottom = 76;
    if (isElementVisible(lore) && getComputedStyle(lore).position === 'fixed') {
      const r = lore.getBoundingClientRect();
      bottom = Math.max(bottom, Math.ceil(window.innerHeight - r.top + 8));
    }
    fab.style.setProperty('bottom', `calc(${bottom}px + env(safe-area-inset-bottom, 0px))`, 'important');
    if (fab.parentElement !== document.body) document.body.appendChild(fab);
    return true;
  }

  function updateFab() {
    if (!state.fab) return;
    const visible = !!state.currentChatId;
    state.fab.hidden = !visible;
    const armed = !!state.currentRoom?.pending;
    state.fab.classList.toggle('rpcm-armed', armed);
    state.fab.title = armed ? `🪽위시 RP Manager · 자동 유지 중 (${pendingProgressText(state.currentRoom.pending)})` : '🪽위시 RP Manager';
    state.fab.setAttribute('aria-label', state.fab.title);
  }

  function ensureManagerButton() {
    if (!state.currentChatId) {
      if (state.fab) state.fab.hidden = true;
      return false;
    }

    const fab = state.fab || createManagerButton();
    const target = findManagerButtonTarget();
    if (target?.host?.isConnected) {
      fab.classList.remove('rpcm-fallback');
      fab.style.removeProperty('bottom');
      const requestedBefore = target.before === fab ? fab.nextSibling : target.before;
      const before = requestedBefore?.parentElement === target.host ? requestedBefore : null;
      if (fab.parentElement !== target.host || fab.nextSibling !== before) target.host.insertBefore(fab, before);
      fab.dataset.rpcmPlacement = target.kind;
    } else {
      mountManagerFallback(fab);
      fab.dataset.rpcmPlacement = 'fixed-fallback';
    }
    state.fab = fab;
    updateFab();
    return true;
  }

  function createFab() {
    // 상단 ‘기억 삽입 / Lore’ 액션바가 늦게 렌더링될 수 있으므로 여기서는 주입을 시도만 하고,
    // routeTick에서도 계속 가볍게 확인해 사라졌을 때 자동 복구합니다.
    ensureManagerButton();
  }

  async function openModal() {
    const chatId = getChatIdFromPath();
    if (!chatId) {
      notify('채팅방 화면에서만 사용할 수 있습니다.', 'warn');
      return;
    }
    await ensureCurrentRoom(chatId, true);
    if (state.modal) state.modal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'rpcm-overlay';
    // 호환 모드: 바깥 영역 클릭을 가로채지 않습니다. 닫기 버튼으로만 닫습니다.
    document.body.appendChild(overlay);
    state.modal = overlay;
    renderModal();
  }

  function closeModal() {
    state.modal?.remove();
    state.modal = null;
  }

  function renderModalIfOpen() {
    if (state.modal) renderModal();
    updateFab();
  }

  function applyModalPosition() {
    const wrap = state.modal?.querySelector('#rpcm-modal-wrap');
    if (!wrap || window.innerWidth <= 680) return;
    const p = state.modalPos || loadModalPosition();
    if (!p) return;
    const maxLeft = Math.max(0, window.innerWidth - wrap.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - Math.min(wrap.offsetHeight, window.innerHeight - 8));
    wrap.style.left = `${Math.max(0, Math.min(maxLeft, p.left))}px`;
    wrap.style.top = `${Math.max(0, Math.min(maxTop, p.top))}px`;
    wrap.style.right = 'auto';
  }

  function bindModalDrag() {
    const overlay = state.modal;
    const wrap = overlay?.querySelector('#rpcm-modal-wrap');
    const header = overlay?.querySelector('.rpcm-header');
    if (!wrap || !header || window.innerWidth <= 680) return;
    applyModalPosition();

    header.onmousedown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button,input,textarea,a')) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      header.classList.add('rpcm-dragging');
      wrap.style.right = 'auto';

      const move = (ev) => {
        const maxLeft = Math.max(0, window.innerWidth - wrap.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - 44);
        const left = Math.max(0, Math.min(maxLeft, ev.clientX - dx));
        const top = Math.max(0, Math.min(maxTop, ev.clientY - dy));
        wrap.style.left = `${left}px`;
        wrap.style.top = `${top}px`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        header.classList.remove('rpcm-dragging');
        const r = wrap.getBoundingClientRect();
        saveModalPosition(r.left, r.top);
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    };
  }

  function statusForChars(chars, maxChars) {
    const ratio = maxChars ? chars / maxChars : 0;
    if (chars > maxChars) return { cls: 'bad', label: '한도 초과', color: '#ef4444', ratio: 1 };
    if (chars > APP.safeChars || ratio > .9) return { cls: 'warn', label: '한도 근접', color: '#f59e0b', ratio };
    return { cls: '', label: '여유', color: '#22c55e', ratio };
  }

  function renderModal() {
    const overlay = state.modal;
    const room = state.currentRoom;
    if (!overlay || !room) return;

    // 비동기 설정 변경 후 전체 재렌더가 필요해도 사용자가 보고 있던 위치를 유지합니다.
    const previousBody = overlay.querySelector('.rpcm-body');
    const previousScrollTop = previousBody ? previousBody.scrollTop : null;
    const hadPreviousRender = !!previousBody;
    const previouslyOpenSlots = new Set([...overlay.querySelectorAll('.rpcm-slot[open][data-slot-id]')].map(el => String(el.dataset.slotId || '')));

    normalizeRoomSlots(room);
    const displayItems = room.pending ? activePendingItems(room.pending) : snapshotSelectedItems(room);
    const stats = statsForItems(displayItems);
    const breakdown = contextBreakdown(displayItems);
    const warnings = getDataWarnings(room);
    const duplicateGroups = duplicateLogDateGroups(room);
    const logBlocksForIssues = parseDatedLogBlocks((room.slots || []).find(s => s.id === 'logSummary')?.content || '');
    const hasLogDateIssues = logBlocksForIssues.some(b => b.isUnknown || (!b.isUnknown && b.year == null));
    const manualLogStats = manualLogSelectionStats(room);
    const maxChars = Number(room.maxChars) || APP.defaultMaxChars;
    const st = statusForChars(stats.block, maxChars);
    const pending = room.pending;

    overlay.innerHTML = `
      <div id="rpcm-modal-wrap">
        <div id="rpcm-modal">
          <div class="rpcm-header">
            <div><div class="rpcm-title">${esc(APP.name)}</div><div class="rpcm-sub">${esc(room.label || '현재 채팅방')} · 방별 독립 · ID ${esc(shortId(room.chatId))}</div></div>
            <div class="rpcm-spacer"></div>
            <button class="rpcm-iconbtn" id="rpcm-close">✕</button>
          </div>
          <div class="rpcm-body">
            ${pending ? `<div class="rpcm-pending"><div>🟠 <strong>${pending.verified ? '서버 주입 확인됨 ✓' : '서버 주입 확인 필요'}</strong><br>${esc(pendingProgressText(pending))}<br>현재 carrier AI ${esc(shortId(pending.messageId))} · 숨김 컨텍스트 ${formatCount(pending.injectedChars)}자 · 서버 raw ${formatCount(pending.serverChars || pending.carrierChars)}자</div><div class="rpcm-spacer"></div><button class="rpcm-btn secondary" id="rpcm-show-raw">주입 내용 확인</button><button class="rpcm-btn secondary" id="rpcm-reverify">서버 재검증</button><button class="rpcm-btn warn" id="rpcm-restore-now">지금 해제</button></div>` : ''}
            <div class="rpcm-summary">
              <div class="rpcm-summary-head">
                <div><div class="rpcm-summary-label">${pending ? '현재 주입 중인 컨텍스트' : '다음 주입 컨텍스트'}</div><div class="rpcm-summary-main"><strong>${formatCount(stats.block)} / 45,000자</strong><span class="rpcm-summary-count">${stats.count}개 항목</span></div></div>
                <div class="rpcm-summary-side"><span class="rpcm-summary-status" style="color:${st.color}">${st.label}</span><label class="rpcm-limit"><input id="rpcm-maxchars" type="hidden" value="45000">최대 45,000자 고정</label></div>
              </div>
              <div class="rpcm-gauge ${st.cls}"><span style="width:${Math.max(1, Math.min(100, st.ratio * 100))}%"></span></div>
              <div class="rpcm-breakdown">${breakdown.map(x => `<span class="rpcm-breakdown-chip"><strong>${esc(x.label)}</strong><span>${x.count}개 · ${formatCount(x.chars)}자</span></span>`).join('')}</div>
            </div>
            ${warnings.length ? `<div class="rpcm-warnings"><div>⚠ ${warnings.map(esc).join('<br>')}</div>${duplicateGroups.length ? `<button type="button" class="rpcm-warning-action" id="rpcm-resolve-duplicate-logs">중복 날짜 바로 정리</button>` : ''}${hasLogDateIssues ? `<button type="button" class="rpcm-warning-action" id="rpcm-normalize-log-dates">날짜 / 연도 바로 수정</button>` : ''}</div>` : ''}
            ${displayItems.some(i => i.autoType) ? `<div class="rpcm-auto-active"><div class="rpcm-auto-active-title">자동 호출된 항목 · 왜 들어왔는지</div>${displayItems.filter(i => i.autoType).map(i => { const isLogItem = i.group === 'log-auto' || i.sourceSlotId === 'logSummary' || /-log$/.test(String(i.autoType || '')); return `<div class="rpcm-auto-active-row"><span class="rpcm-auto-badge">${esc(itemCategory(i))}</span><div><strong>${esc(i.title)}</strong>${esc(itemReason(i) || '자동 호출')}</div><div class="rpcm-auto-active-meta"><span>${formatCount(String(i.content || '').length)}자 · ${esc(remainingLabelForItem(i))}</span>${isLogItem ? `<button type="button" class="rpcm-auto-inline-toggle" title="로그 내용 펼치기" aria-label="로그 내용 펼치기">▾</button>` : ''}</div>${isLogItem ? `<pre class="rpcm-auto-inline-content" hidden>${esc(String(i.content || '').trim())}</pre>` : ''}</div>`; }).join('')}</div>` : ''}

            <div class="rpcm-section">
              <div class="rpcm-section-head"><div><div class="rpcm-section-title">기본 메모</div><div class="rpcm-section-desc">현재상태는 HOT MEMORY로 통째 유지합니다. 로그요약 원문은 날짜 블록 저장소로만 보관하고, 직접 선택·최신·관련·고정 날짜 블록만 45,000자 예산 안에서 골라 주입합니다.</div></div></div>
              <div id="rpcm-current-state-slot"></div>
              <div class="rpcm-auto-panel"><label><input type="checkbox" id="rpcm-auto-log" ${room.autoLogRecallEnabled ? 'checked' : ''}> 날짜별 로그 자동 호출</label><label>최신 <select id="rpcm-auto-log-recent"><option value="1" ${Number(room.autoLogRecentBlocks)===1?'selected':''}>1개</option><option value="2" ${Number(room.autoLogRecentBlocks)!==1?'selected':''}>2개</option></select></label><label>관련 과거 최대 <select id="rpcm-auto-log-related"><option value="1" ${Number(room.autoLogRelatedBlocks)===1?'selected':''}>1개</option><option value="2" ${Number(room.autoLogRelatedBlocks)===2?'selected':''}>2개</option><option value="3" ${Number(room.autoLogRelatedBlocks)===3?'selected':''}>3개</option><option value="4" ${Number(room.autoLogRelatedBlocks)===4?'selected':''}>4개</option></select></label><button type="button" class="rpcm-lib-small" id="rpcm-log-date-fix">🛠 날짜 수정</button><button type="button" class="rpcm-lib-small" id="rpcm-log-manage">🗓️ 로그 저장소 · 주입 선택${manualLogStats.count ? ` (직접 ${manualLogStats.count})` : ''}</button></div>${manualLogStats.count ? `<div class="rpcm-log-help"><b>직접 선택 중</b> ${manualLogStats.count}개 · ${formatCount(manualLogStats.chars)}자 · 로그 저장소에서 직접 선택·📌항상 호출·🚫자동 제외를 한 번에 관리합니다. 자동 호출을 꺼도 직접 선택한 날짜는 유지됩니다.</div>` : ''}
              <div id="rpcm-log-summary-slot"></div>
            </div>

            <div class="rpcm-section">
              <div class="rpcm-section-head rpcm-character-head"><div><div class="rpcm-section-title">캐릭터 설정</div><div class="rpcm-section-desc">캐릭터별로 저장·체크하고 인물마다 유지 주기를 따로 설정합니다.<br>전역 설정집 하나를 자동감지용으로 지정하면 최근 실제 RP에서 정식 이름·성·영문명을 자동 감지해 필요한 캐릭터만 불러옵니다.<br>‘추가 별칭’은 설정팩에 없는 애칭·약칭·호칭을 등록할 때만 사용합니다. 체크 상태와 남은 턴은 공유하지 않습니다.</div></div><div class="rpcm-charlib-actions"><button class="rpcm-add-btn" id="rpcm-charlib-save">설정집 저장</button><button class="rpcm-add-btn" id="rpcm-charlib-load">설정집 불러오기</button><button class="rpcm-add-btn" id="rpcm-add-character">＋ 캐릭터 추가</button></div></div>
              <div class="rpcm-auto-panel"><label><input type="checkbox" id="rpcm-auto-char" ${room.autoCharacterDetection ? 'checked' : ''}> 캐릭터 자동 감지</label><label>자동감지 설정집 <select id="rpcm-auto-char-library"><option value="">선택 안 함</option></select></label><label><input type="checkbox" id="rpcm-auto-char-reset" ${room.autoCharacterResetOnReappear ? 'checked' : ''}> 다시 등장하면 유지턴 리셋</label><div class="rpcm-auto-note">자동 감지·관련 로그 선택은 주입 전에도 <b>다음 주입 준비</b>를 위해 갱신됩니다. 실제 서버 숨김 주입은 <b>주입 시작</b>을 누른 뒤에만 동작합니다.</div></div>
              <div id="rpcm-character-slots"></div>
            </div>

            <div class="rpcm-section">
              <div class="rpcm-section-head"><div><div class="rpcm-section-title">기타</div><div class="rpcm-section-desc">OOC, 출력 규칙, 사칭방지 프롬 등 자주 채팅에 붙여오는 것들을 자유롭게 추가합니다.</div></div><button class="rpcm-add-btn" id="rpcm-add-extra">＋ 기타 추가</button></div>
              <div id="rpcm-extra-slots"></div>
            </div>

            <div class="rpcm-tools">
              <button class="rpcm-mini" id="rpcm-preview-btn">주입 구성 미리보기</button>
              <button class="rpcm-mini" id="rpcm-backup">전체 백업 JSON</button>
              <button class="rpcm-mini" id="rpcm-import">백업 불러오기</button>
              <button class="rpcm-mini" id="rpcm-reset">현재 RP 데이터 초기화</button>
              <input id="rpcm-import-file" type="file" accept=".json" style="display:none">
            </div>
            <div id="rpcm-preview"></div>
          </div>
        </div>
        <div class="rpcm-footer">
          <div class="rpcm-footnote">USER 메시지는 절대 수정하지 않습니다. 체크 변경은 주입 중에도 현재 AI carrier에 즉시 반영됩니다. 자동 캐릭터/관련 로그 호출은 완료된 최근 RP를 감지해 다음 응답용 carrier부터 적용합니다.</div>
          <span class="rpcm-save-status saved" id="rpcm-save-status">로컬 저장됨</span>
          <button class="rpcm-btn secondary" id="rpcm-save">저장</button>
          <button class="rpcm-btn primary" id="rpcm-arm" ${pending || !stats.count || stats.block > maxChars ? 'disabled' : ''}>주입 시작</button>
        </div>
      </div>`;

    const currentStateWrap = overlay.querySelector('#rpcm-current-state-slot');
    const logSummaryWrap = overlay.querySelector('#rpcm-log-summary-slot');
    const charWrap = overlay.querySelector('#rpcm-character-slots');
    const extraWrap = overlay.querySelector('#rpcm-extra-slots');

    overlay.querySelectorAll('.rpcm-auto-inline-toggle').forEach(btn => {
      btn.onclick = () => {
        const row = btn.closest('.rpcm-auto-active-row');
        const content = row?.querySelector('.rpcm-auto-inline-content');
        if (!content) return;
        content.hidden = !content.hidden;
        btn.textContent = content.hidden ? '▾' : '▴';
        btn.title = content.hidden ? '로그 내용 펼치기' : '로그 내용 접기';
        btn.setAttribute('aria-label', btn.title);
      };
    });

    const resolveDupBtn = overlay.querySelector('#rpcm-resolve-duplicate-logs');
    if (resolveDupBtn) resolveDupBtn.onclick = async () => {
      readModalIntoRoom();
      const changed = await openDuplicateLogResolverDialog(room);
      if (!changed) return;
      try {
        if (room.pending) await rebuildPendingLogItems(room, 'duplicate-log-resolve');
        await saveRoom(room);
        notify('중복 날짜 로그를 선택한 블록 기준으로 정리했습니다.', 'success', 4200);
        renderModalIfOpen();
      } catch (e) { notify(`중복 로그 정리 반영 실패: ${e.message}`, 'error', 6500); }
    };

    const normalizeDatesWarningBtn = overlay.querySelector('#rpcm-normalize-log-dates');
    if (normalizeDatesWarningBtn) normalizeDatesWarningBtn.onclick = async () => {
      readModalIntoRoom();
      const changed = await openLogDateNormalizerDialog(room);
      if (!changed) return;
      try {
        if (room.pending) await rebuildPendingLogItems(room, 'log-date-normalize');
        await saveRoom(room);
        notify('로그 제목의 날짜/연도 수정을 반영했습니다.', 'success', 4200);
        renderModalIfOpen();
      } catch (e) { notify(`날짜 수정 반영 실패: ${e.message}`, 'error', 6500); }
    };

    function createSlotCard(slot, openDefault = false) {
      const d = document.createElement('details');
      d.className = 'rpcm-slot';
      d.dataset.slotId = slot.id;
      d.open = hadPreviousRender ? previouslyOpenSlots.has(String(slot.id)) : openDefault;
      const deletable = slot.group === 'character' || slot.group === 'extra';
      const titleEditable = deletable;
      const pendingItem = pending?.items?.find(i => i.slotId === slot.id && (Number(i.totalTurns || 0) === 0 || Number(i.usedTurns || 0) < Number(i.totalTurns || 0)));
      d.innerHTML = `
        <summary>
          <input class="rpcm-enable" type="checkbox" ${slot.enabled ? 'checked' : ''}>
          <span class="rpcm-slot-name">${slot.id === 'currentState' ? '🧭 ' : slot.id === 'logSummary' ? '🗓️ ' : ''}${esc(slot.title)}</span>
          ${DEFAULT_GUIDES[slot.id] ? `<button class="rpcm-guide-toggle" type="button" title="GPT/Gemini에 복사해 쓸 수 있는 업데이트 지침">지침</button>` : ''}
          ${pendingItem ? `<span class="rpcm-slot-remain">${esc(remainingLabelForItem(pendingItem))}</span>` : ''}
          <span class="rpcm-slot-count">${formatCount(String(slot.content || '').length)}자</span>
          ${deletable ? `<button class="rpcm-delete-btn" type="button">삭제</button>` : ''}
          <span class="rpcm-chevron">▶</span>
        </summary>
        <div class="rpcm-edit">
          ${titleEditable ? `<input class="rpcm-title-input" value="${esc(slot.title)}" placeholder="항목 이름">` : `<div class="rpcm-fixed-note">${slot.id === 'currentState' ? '다음 RP에 필요한 최신 상태·관계·정보격차·비밀·미해결 후크·현재 부상/소유물 등 현재 유효한 HOT MEMORY를 넣습니다. 통째로 주입합니다.' : '날짜별 사건 요약 전체를 붙여넣습니다. 원문은 저장소로 보관하고, 날짜 블록 단위로 분해해 직접 선택·최신·관련·고정 로그만 골라 주입합니다.'}</div>${DEFAULT_GUIDES[slot.id] ? `<div class="rpcm-guide-panel" hidden><div class="rpcm-guide-head"><span>GPT / Gemini용 업데이트 지침 · 수정 내용은 이 브라우저에 자동 저장됩니다.</span><button class="rpcm-guide-icon" type="button" data-guide-copy title="지침 복사" aria-label="지침 복사">${GUIDE_COPY_ICON}</button><button class="rpcm-guide-reset" type="button" data-guide-reset>기본값 복원</button></div><textarea class="rpcm-guide-textarea" spellcheck="false"></textarea></div>` : ''}`}
          ${slot.group === 'character' ? `<div class="rpcm-auto-terms"><strong>자동 감지어</strong> · ${esc(characterAutomaticTerms(slot).slice(0, 10).join(' · ') || '캐릭터 이름을 입력하면 자동 생성됩니다.')}${characterAutomaticTerms(slot).length > 10 ? ' · …' : ''}</div><div class="rpcm-alias-row"><input class="rpcm-alias-input" value="${esc((slot.aliases || []).join(', '))}" placeholder="추가 별칭 (선택): 애칭·약칭·호칭"><label class="rpcm-auto-pin"><input type="checkbox" class="rpcm-auto-pinned" ${slot.autoPinned ? 'checked' : ''}> 📌 자동 고정</label><label class="rpcm-auto-exclude"><input type="checkbox" class="rpcm-auto-excluded" ${slot.autoExcluded ? 'checked' : ''}> 🚫 자동감지 제외</label></div>` : ''}
          <div class="rpcm-slot-options"><span>이 항목 유지</span><select class="rpcm-slot-retention">
            <option value="1" ${Number(slot.retentionTurns)===1?'selected':''}>1턴</option>
            <option value="3" ${Number(slot.retentionTurns)===3?'selected':''}>3턴</option>
            <option value="5" ${Number(slot.retentionTurns)===5?'selected':''}>5턴</option>
            <option value="10" ${Number(slot.retentionTurns)===10?'selected':''}>10턴</option>
            <option value="0" ${Number(slot.retentionTurns)===0?'selected':''}>직접 해제</option>
          </select><span>AI 응답마다 이 항목만 개별 차감</span></div>
          <textarea class="rpcm-textarea" placeholder="여기에 ${esc(slot.title)} 내용을 붙여넣으세요."></textarea>
        </div>`;

      const cb = d.querySelector('.rpcm-enable');
      const ta = d.querySelector('.rpcm-textarea');
      const count = d.querySelector('.rpcm-slot-count');
      const name = d.querySelector('.rpcm-slot-name');
      const titleInput = d.querySelector('.rpcm-title-input');
      const retentionInput = d.querySelector('.rpcm-slot-retention');
      const autoTermsEl = d.querySelector('.rpcm-auto-terms');
      const guideToggle = d.querySelector('.rpcm-guide-toggle');
      const guidePanel = d.querySelector('.rpcm-guide-panel');
      const guideTextarea = d.querySelector('.rpcm-guide-textarea');
      const guideCopy = d.querySelector('[data-guide-copy]');
      const guideReset = d.querySelector('[data-guide-reset]');
      let guideSaveTimer = 0;
      ta.value = slot.content || '';
      if (guideTextarea) guideTextarea.value = getGuideText(slot.id);
      if (guideToggle && guidePanel) {
        guideToggle.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          d.open = true;
          const willOpen = guidePanel.hidden;
          guidePanel.hidden = !willOpen;
          guideToggle.classList.toggle('is-open', willOpen);
          if (willOpen) setTimeout(() => guideTextarea?.focus(), 0);
        };
      }
      if (guideTextarea) guideTextarea.oninput = () => {
        clearTimeout(guideSaveTimer);
        guideSaveTimer = setTimeout(() => saveGuideText(slot.id, guideTextarea.value), 250);
      };
      if (guideCopy) guideCopy.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (guideTextarea) saveGuideText(slot.id, guideTextarea.value);
        const ok = await copyPlainText(guideTextarea?.value || '');
        notify(ok ? '지침을 클립보드에 복사했습니다.' : '지침 복사에 실패했습니다.', ok ? 'success' : 'error', 3200);
      };
      if (guideReset) guideReset.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('이 지침을 기본값으로 복원할까요?\n직접 수정한 내용은 사라집니다.')) return;
        const restored = resetGuideText(slot.id);
        if (guideTextarea) guideTextarea.value = restored;
        notify('지침을 기본값으로 복원했습니다.', 'success', 3200);
      };
      const refreshAutoTerms = () => {
        if (!autoTermsEl) return;
        const terms = characterAutomaticTerms(slot);
        autoTermsEl.innerHTML = `<strong>자동 감지어</strong> · ${esc(terms.slice(0, 10).join(' · ') || '캐릭터 이름을 입력하면 자동 생성됩니다.')}${terms.length > 10 ? ' · …' : ''}`;
      };

      cb.onclick = e => e.stopPropagation();
      cb.onchange = async () => {
        // debounce 저장 전에 바로 체크한 경우에도 현재 화면의 최신 입력값으로 carrier를 재구성합니다.
        slot.content = ta.value;
        if (titleInput) slot.title = titleInput.value.trim() || (slot.group === 'character' ? '새 캐릭터' : '기타');
        if (retentionInput) slot.retentionTurns = normalizeRetentionTurns(retentionInput.value);
        const desired = cb.checked;
        if (!room.pending) { slot.enabled = desired; await saveRoom(room); refreshStatsOnly(); return; }
        const question = desired
          ? `현재 컨텍스트가 주입 중입니다.\n‘${slot.title}’ 항목을 현재 주입에 추가할까요?\n확인하면 이 항목의 ${retentionLabel(slot.retentionTurns)} 유지 주기가 지금부터 새로 시작됩니다.`
          : `현재 컨텍스트가 주입 중입니다.\n‘${slot.title}’ 항목을 현재 주입에서 제거할까요?`;
        if (!confirm(question)) { cb.checked = !desired; slot.enabled = !desired; refreshStatsOnly(); return; }
        cb.disabled = true;
        try { await setSlotEnabledDuringPending(room, slot, desired); }
        catch (e) { cb.checked = !desired; notify(`주입 변경 실패: ${e.message}`, 'error', 6500); }
        finally { cb.disabled = false; renderModalIfOpen(); }
      };
      if (retentionInput) retentionInput.onchange = async () => {
        slot.retentionTurns = normalizeRetentionTurns(retentionInput.value);
        if (room.pending) {
          const targets = slot.id === 'logSummary'
            ? (room.pending.items || []).filter(i => i.slotId === 'logSummary' || i.sourceSlotId === 'logSummary' || i.group === 'log-auto')
            : (room.pending.items || []).filter(i => i.slotId === slot.id);
          if (targets.length) {
            for (const item of targets) {
              item.totalTurns = slot.retentionTurns;
              item.usedTurns = Number(item.totalTurns || 0) === 0 ? 0 : Math.min(Number(item.usedTurns || 0), Math.max(0, Number(item.totalTurns || 0) - 1));
            }
            await syncPendingCarrier(room, 'retention-change').catch(e => notify(`유지주기 반영 실패: ${e.message}`, 'error', 6000));
          }
        }
        await saveRoom(room);
        renderModalIfOpen();
      };
      const aliasInput = d.querySelector('.rpcm-alias-input');
      if (aliasInput) aliasInput.oninput = debounce(() => { slot.aliases = aliasInput.value.split(',').map(x => x.trim()).filter(Boolean); queueRoomAutoSave(room); }, 250);
      const pinnedInput = d.querySelector('.rpcm-auto-pinned');
      if (pinnedInput) pinnedInput.onchange = async () => {
        const desired = pinnedInput.checked;
        slot.autoPinned = desired;
        if (desired) {
          slot.autoExcluded = false;
          if (excludedInput) excludedInput.checked = false;
          slot.enabled = true;
          slot.lastAutoMatch = '사용자 고정';
          cb.checked = true;
          if (room.pending) {
            if (!confirm(`‘${slot.title}’을 자동 고정하고 현재 주입에도 즉시 추가할까요?`)) { slot.autoPinned = false; pinnedInput.checked = false; return; }
            await setSlotEnabledDuringPending(room, slot, true).catch(e => { slot.autoPinned = false; pinnedInput.checked = false; notify(`고정 반영 실패: ${e.message}`, 'error', 6000); });
          }
        }
        await saveRoom(room);
        refreshStatsOnly();
      };
      const excludedInput = d.querySelector('.rpcm-auto-excluded');
      if (excludedInput) excludedInput.onchange = async () => {
        slot.autoExcluded = excludedInput.checked;
        if (slot.autoExcluded && slot.autoPinned) { slot.autoPinned = false; if (pinnedInput) pinnedInput.checked = false; }
        await saveRoom(room);
        refreshStatsOnly();
      };
      if (titleInput) {
        titleInput.oninput = () => {
          slot.title = titleInput.value;
          name.textContent = titleInput.value || (slot.group === 'character' ? '새 캐릭터' : '기타');
          refreshStatsOnly();
          refreshAutoTerms();
          queueRoomAutoSave(room);
        };
      }
      const syncPendingContentEdit = debounce(async () => {
        if (!room.pending) return;
        try {
          // 주입 중 본문이 바뀌면 현재 carrier의 복사본도 갱신합니다.
          // 로그요약은 최신/관련/직접/고정 날짜 후보를 다시 계산합니다.
          await syncEditedSlotIntoPending(room, slot, slot.id === 'logSummary' ? 'log-content-edit' : 'slot-content-edit');
        } catch (e) {
          notify(`현재 주입 내용 갱신 실패: ${e.message}`, 'error', 6500);
        }
      }, 700);
      ta.oninput = debounce(() => {
        slot.content = ta.value;
        count.textContent = `${formatCount(ta.value.length)}자`;
        refreshStatsOnly();
        refreshAutoTerms();
        queueRoomAutoSave(room);
        syncPendingContentEdit();
      }, 100);

      const del = d.querySelector('.rpcm-delete-btn');
      if (del) {
        del.onclick = async e => {
          e.preventDefault(); e.stopPropagation();
          const title = slot.title || '이 항목';
          const activeInPending = !!room.pending?.items?.some(i => i.slotId === slot.id && (Number(i.totalTurns || 0) === 0 || Number(i.usedTurns || 0) < Number(i.totalTurns || 0)));
          if (!confirm(activeInPending ? `'${title}' 항목은 현재 주입에도 들어 있습니다.\n현재 주입에서 제거하고 항목도 삭제할까요?` : `'${title}' 항목을 삭제할까요?`)) return;
          if (activeInPending) {
            room.pending.items = room.pending.items.filter(i => i.slotId !== slot.id);
            await syncPendingCarrier(room, 'delete-slot');
          }
          room.slots = room.slots.filter(x => x.id !== slot.id);
          if (slot.group === 'extra' && !room.slots.some(x => x.group === 'extra')) room.slots.push(makeDynamicSlot('extra', '기타'));
          await saveRoom(room);
          renderModalIfOpen();
        };
      }
      return d;
    }

    const fixed = room.slots.filter(s => s.group === 'fixed');
    const chars = room.slots.filter(s => s.group === 'character');
    const extras = room.slots.filter(s => s.group === 'extra');
    fixed.forEach(slot => {
      if (slot.id === 'currentState') currentStateWrap?.appendChild(createSlotCard(slot, true));
      else if (slot.id === 'logSummary') logSummaryWrap?.appendChild(createSlotCard(slot, true));
    });
    if (!chars.length) charWrap.innerHTML = `<div class="rpcm-empty">아직 캐릭터 설정이 없습니다. 위의 ‘＋ 캐릭터 추가’를 눌러 인물별로 등록하세요.</div>`;
    else chars.forEach(slot => charWrap.appendChild(createSlotCard(slot, false)));
    extras.forEach(slot => extraWrap.appendChild(createSlotCard(slot, false)));

    const autoLogCb = overlay.querySelector('#rpcm-auto-log');
    const autoLogRecent = overlay.querySelector('#rpcm-auto-log-recent');
    const autoLogRelated = overlay.querySelector('#rpcm-auto-log-related');
    if (autoLogCb) autoLogCb.onchange = async () => {
      const previous = !!room.autoLogRecallEnabled;
      const desired = autoLogCb.checked;
      if (room.pending && !confirm(`현재 컨텍스트가 주입 중입니다.\n로그 자동 선택을 ${desired ? '켜기' : '끄기'}로 즉시 바꿀까요?
자동 선택을 꺼도 직접 선택/📌고정 날짜는 유지됩니다.`)) { autoLogCb.checked = previous; return; }
      room.autoLogRecallEnabled = desired;
      try { if (room.pending) await rebuildPendingLogItems(room, 'log-auto-toggle'); await saveRoom(room); }
      catch (e) { room.autoLogRecallEnabled = previous; autoLogCb.checked = previous; notify(`로그 방식 변경 실패: ${e.message}`, 'error', 6500); }
      renderModalIfOpen();
    };
    if (autoLogRecent) autoLogRecent.onchange = async () => {
      room.autoLogRecentBlocks = Number(autoLogRecent.value) || APP.defaultRecentLogBlocks;
      try { if (room.pending && room.autoLogRecallEnabled) await rebuildPendingLogItems(room, 'log-recent-count'); await saveRoom(room); }
      catch (e) { notify(`최신 로그 개수 반영 실패: ${e.message}`, 'error', 6000); }
      refreshStatsOnly();
    };
    if (autoLogRelated) autoLogRelated.onchange = async () => {
      room.autoLogRelatedBlocks = Number(autoLogRelated.value) || APP.defaultRelatedLogBlocks;
      try { if (room.pending && room.autoLogRecallEnabled) await rebuildPendingLogItems(room, 'log-related-count'); await saveRoom(room); }
      catch (e) { notify(`관련 로그 개수 반영 실패: ${e.message}`, 'error', 6000); }
      refreshStatsOnly();
    };
    const logDateFixBtn = overlay.querySelector('#rpcm-log-date-fix');
    if (logDateFixBtn) logDateFixBtn.onclick = async () => {
      readModalIntoRoom();
      const changed = await openLogDateNormalizerDialog(room);
      if (!changed) return;
      try {
        if (room.pending) await rebuildPendingLogItems(room, 'log-date-normalize');
        await saveRoom(room);
        notify('날짜/연도 정리를 로그요약에 반영했습니다.', 'success', 4200);
        renderModalIfOpen();
      } catch (e) { notify(`날짜 수정 반영 실패: ${e.message}`, 'error', 6000); }
    };

    const logManageBtn = overlay.querySelector('#rpcm-log-manage');
    if (logManageBtn) logManageBtn.onclick = async () => {
      readModalIntoRoom();
      const changed = await openLogRecallManagerDialog(room);
      if (!changed) return;
      try {
        if (room.pending) await rebuildPendingLogItems(room, 'log-direct-pin-exclude');
        await saveRoom(room);
        notify('날짜별 로그 직접선택/고정/제외 설정을 반영했습니다.', 'success', 4200);
        renderModalIfOpen();
      } catch (e) { notify(`로그 관리 반영 실패: ${e.message}`, 'error', 6000); }
    };

    const autoCharCb = overlay.querySelector('#rpcm-auto-char');
    const autoCharReset = overlay.querySelector('#rpcm-auto-char-reset');
    const autoCharLibrary = overlay.querySelector('#rpcm-auto-char-library');
    if (autoCharCb) autoCharCb.onchange = async () => { room.autoCharacterDetection = autoCharCb.checked; await saveRoom(room); };
    if (autoCharReset) autoCharReset.onchange = async () => { room.autoCharacterResetOnReappear = autoCharReset.checked; await saveRoom(room); };
    if (autoCharLibrary) {
      listUsableCharacterLibraries().then(libs => {
        if (!state.modal || !document.contains(autoCharLibrary)) return;
        for (const lib of libs) {
          const opt = document.createElement('option');
          opt.value = lib.scopeId;
          opt.textContent = `${libraryDisplayName(lib)} (${lib.characters.length}명)`;
          if (lib.scopeId === room.autoCharacterLibraryId) opt.selected = true;
          autoCharLibrary.appendChild(opt);
        }
      }).catch(console.warn);
      autoCharLibrary.onchange = async () => { room.autoCharacterLibraryId = autoCharLibrary.value || ''; await saveRoom(room); };
    }

    const charLibSaveBtn = overlay.querySelector('#rpcm-charlib-save');
    const charLibLoadBtn = overlay.querySelector('#rpcm-charlib-load');

    if (charLibSaveBtn) charLibSaveBtn.onclick = async () => {
      try {
        if (room.pending) { notify('주입 중에는 설정집을 변경하지 않는 편이 안전합니다. 먼저 지금 해제해 주세요.', 'warn', 5000); return; }
        readModalIntoRoom();
        await saveRoom(room);
        const available = characterSlotsForLibrary(room);
        if (!available.length) { notify('저장할 캐릭터 설정이 없습니다.', 'warn'); return; }

        const choice = await openCharacterSelectionDialog({
          title: '설정집에 저장할 캐릭터 선택',
          description: '체크한 캐릭터만 선택한 설정집에 저장/갱신합니다.',
          items: available,
          confirmText: '선택 항목 저장',
          preserveOption: true,
          preserveDefault: true,
        });
        if (!choice) return;

        const allLibraries = await listUsableCharacterLibraries();
        const lastLib = room.lastCharacterLibraryId ? allLibraries.find(lib => lib.scopeId === room.lastCharacterLibraryId) : null;
        const defaultName = libraryDisplayName(lastLib) || `${room.label || '캐릭터'} 설정집`;
        const entered = prompt('설정집 이름을 입력해 주세요.\n같은 이름으로 저장하면 기존 설정집을 갱신합니다.', defaultName);
        if (entered === null) return;
        const presetName = String(entered || '').trim();
        if (!presetName) { notify('설정집 이름을 입력해 주세요.', 'warn'); return; }

        const nameKey = normalizedLibraryLabel(presetName);
        let existing = allLibraries.find(lib => normalizedLibraryLabel(libraryDisplayName(lib)) === nameKey) || null;
        if (!existing && lastLib && normalizedLibraryLabel(libraryDisplayName(lastLib)) === nameKey) existing = lastLib;
        const scopeId = existing?.scopeId || presetScopeIdFromName(presetName);
        const merged = mergeCharacterLibraryItems(existing?.characters || [], choice.items, choice.preserve);
        const scopeAliases = [...new Set([...(existing?.scopeAliases || []), ...getCharacterLibraryScopeCandidates(room), scopeId])];
        await saveCharacterLibrary({
          ...(existing || {}),
          scopeId,
          kind: 'preset',
          presetName,
          label: presetName,
          sourceLabel: room.label || existing?.sourceLabel || '',
          sourceLabels: [...new Set([...(existing?.sourceLabels || []), room.label].filter(Boolean))],
          scopeAliases,
          characters: merged,
          createdAt: existing?.createdAt || nowIso(),
        });
        room.lastCharacterLibraryId = scopeId;
        if (!room.autoCharacterLibraryId) room.autoCharacterLibraryId = scopeId;
        await saveRoom(room);
        notify(`설정집 ‘${presetName}’ 저장 완료 · 선택 ${choice.items.length}명 · 총 ${merged.length}명`, 'success', 5500);
      } catch (e) { notify(`설정집 저장 실패: ${e.message}`, 'error', 6000); }
    };

    if (charLibLoadBtn) charLibLoadBtn.onclick = async () => {
      try {
        if (room.pending) { notify('주입 중에는 설정집을 불러올 수 없습니다. 먼저 지금 해제해 주세요.', 'warn', 5000); return; }
        readModalIntoRoom();
        await saveRoom(room);

        const libraries = await listUsableCharacterLibraries();
        if (!libraries.length) { notify('저장된 캐릭터 설정집이 없습니다. 먼저 어느 방에서든 ‘설정집 저장’을 눌러주세요.', 'warn', 5500); return; }
        const library = await openLibraryPickerDialog(libraries, { title: '불러올 설정집 선택', confirmText: '선택한 설정집 열기' });
        if (!library) return;

        const choice = await openCharacterSelectionDialog({
          title: '현재 방으로 불러올 캐릭터 선택',
          description: `${libraryDisplayName(library)} · 체크한 캐릭터만 현재 방에 추가/갱신합니다.`,
          items: library.characters,
          confirmText: '선택 항목 불러오기',
        });
        if (!choice) return;
        const result = applySelectedCharacterLibraryToRoom(room, choice.items);
        room.lastCharacterLibraryId = library.scopeId;
        if (!room.autoCharacterLibraryId) room.autoCharacterLibraryId = library.scopeId;
        await saveRoom(room);
        notify(`‘${libraryDisplayName(library)}’ 불러오기 완료 · ${result.count}명 (추가 ${result.added}, 갱신 ${result.updated}) · 체크 해제 상태`, 'success', 6000);
        renderModalIfOpen();
      } catch (e) { notify(`설정집 불러오기 실패: ${e.message}`, 'error', 6000); }
    };

    overlay.querySelector('#rpcm-add-character').onclick = async () => {
      readModalIntoRoom();
      const slot = makeDynamicSlot('character', `캐릭터 ${room.slots.filter(x => x.group === 'character').length + 1}`);
      room.slots.push(slot);
      await saveRoom(room);
      renderModalIfOpen();
      setTimeout(() => {
        const card = state.modal?.querySelector(`[data-slot-id="${slot.id}"]`);
        if (card) { card.open = true; card.querySelector('.rpcm-title-input')?.focus(); }
      }, 50);
    };

    overlay.querySelector('#rpcm-add-extra').onclick = async () => {
      readModalIntoRoom();
      const slot = makeDynamicSlot('extra', `기타 ${room.slots.filter(x => x.group === 'extra').length + 1}`);
      room.slots.push(slot);
      await saveRoom(room);
      renderModalIfOpen();
      setTimeout(() => {
        const card = state.modal?.querySelector(`[data-slot-id="${slot.id}"]`);
        if (card) { card.open = true; card.querySelector('.rpcm-title-input')?.focus(); }
      }, 50);
    };

    overlay.querySelector('#rpcm-close').onclick = closeModal;
    overlay.querySelector('#rpcm-save').onclick = async () => {
      readModalIntoRoom();
      updateSaveStatusUi('saving');
      await saveRoom(room);
      notify('🪽위시 RP Manager 저장 완료', 'success');
      renderModalIfOpen();
    };

    overlay.querySelector('#rpcm-arm').onclick = async () => {
      const btn = overlay.querySelector('#rpcm-arm');
      try {
        btn.disabled = true;
        btn.textContent = '주입 중...';
        readModalIntoRoom();
        await saveRoom(room);
        await armInjection(room);
      } catch (e) {
        notify(e.message, 'error', 6000);
        renderModalIfOpen();
      }
    };

    if (pending) {
      overlay.querySelector('#rpcm-show-raw').onclick = async () => {
        try { await showInjectedRaw(room); }
        catch (e) { notify(`확인 실패: ${e.message}`, 'error', 6000); }
      };
      overlay.querySelector('#rpcm-reverify').onclick = async () => {
        try {
          const r = await reverifyPending(room);
          notify(r.verified ? '서버 재검증 성공 ✓' : '서버에서 숨김 주입 블록을 확인하지 못했습니다.', r.verified ? 'success' : 'error', 5000);
          renderModalIfOpen();
        } catch (e) { notify(`재검증 실패: ${e.message}`, 'error', 6000); }
      };
      overlay.querySelector('#rpcm-restore-now').onclick = async () => {
        try { await restorePending(room, 'manual'); }
        catch (e) { notify(`복원 실패: ${e.message}`, 'error', 6000); }
      };
    }

    bindModalDrag();
    updateSaveStatusUi(state.saveStatus);

    const maxInput = overlay.querySelector('#rpcm-maxchars');
    room.maxChars = APP.defaultMaxChars;
    if (maxInput) maxInput.value = String(APP.defaultMaxChars);

    overlay.querySelector('#rpcm-preview-btn').onclick = () => {
      readModalIntoRoom();
      const p = overlay.querySelector('#rpcm-preview');
      if (p.style.display === 'block') p.style.display = 'none';
      else {
        const items = room.pending ? activePendingItems(room.pending) : snapshotSelectedItems(room);
        p.textContent = items.length ? buildStructuredPreviewText(room, items) : '(선택된 내용 없음)';
        p.style.display = 'block';
      }
    };

    overlay.querySelector('#rpcm-backup').onclick = async () => {
      readModalIntoRoom();
      await saveRoom(room);
      const rooms = await getAllRooms();
      const characterLibraries = await getAllCharacterLibraries();
      const payload = { _rpContextManagerBackup: true, version: APP.version, exportedAt: nowIso(), rooms, characterLibraries };
      downloadText(JSON.stringify(payload, null, 2), `RP_매니저_백업_${new Date().toISOString().slice(0,10)}.json`);
      notify('전체 백업 JSON 저장 완료', 'success');
    };

    const file = overlay.querySelector('#rpcm-import-file');
    overlay.querySelector('#rpcm-import').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data?._rpContextManagerBackup || !Array.isArray(data.rooms)) throw new Error('🪽위시 RP Manager 백업 파일이 아닙니다.');
        if (!confirm(`백업의 ${data.rooms.length}개 RP 데이터를 불러올까요? 같은 채팅방 ID는 덮어씁니다.`)) return;
        for (const r of data.rooms) {
          if (!r?.chatId) continue;
          r.pending = null;
          normalizeRoomSlots(r);
          await saveRoom(r);
        }
        if (Array.isArray(data.characterLibraries)) {
          for (const lib of data.characterLibraries) {
            if (!lib?.scopeId) continue;
            await saveCharacterLibrary(lib);
          }
        }
        await ensureCurrentRoom(getChatIdFromPath(), true);
        notify('백업 불러오기 완료', 'success');
        renderModalIfOpen();
      } catch (e) {
        notify(`불러오기 실패: ${e.message}`, 'error', 6000);
      } finally { file.value = ''; }
    };

    overlay.querySelector('#rpcm-reset').onclick = async () => {
      if (room.pending) { notify('먼저 임시 주입을 복원해 주세요.', 'warn'); return; }
      if (!confirm('현재 채팅방의 🪽위시 RP Manager 데이터만 초기화할까요?')) return;
      await clearCurrentRoom(room.chatId);
      await ensureCurrentRoom(apiChatIdOf(room), true);
      notify('현재 RP 데이터 초기화 완료', 'success');
      renderModalIfOpen();
    };

    function readModalIntoRoom() {
      const nodes = [...overlay.querySelectorAll('.rpcm-slot[data-slot-id]')];
      for (const node of nodes) {
        const slot = room.slots.find(x => x.id === node.dataset.slotId);
        if (!slot) continue;
        slot.enabled = !!node.querySelector('.rpcm-enable')?.checked;
        const titleInput = node.querySelector('.rpcm-title-input');
        if (titleInput) slot.title = titleInput.value.trim() || (slot.group === 'character' ? '새 캐릭터' : '기타');
        slot.content = node.querySelector('.rpcm-textarea')?.value || '';
        const retention = node.querySelector('.rpcm-slot-retention');
        if (retention) slot.retentionTurns = normalizeRetentionTurns(retention.value);
        const aliasInput = node.querySelector('.rpcm-alias-input');
        if (aliasInput) slot.aliases = aliasInput.value.split(',').map(x => x.trim()).filter(Boolean);
        const autoPinned = node.querySelector('.rpcm-auto-pinned');
        if (autoPinned) slot.autoPinned = !!autoPinned.checked;
        const autoExcluded = node.querySelector('.rpcm-auto-excluded');
        if (autoExcluded) slot.autoExcluded = !!autoExcluded.checked;
      }
      room.autoLogRecallEnabled = !!overlay.querySelector('#rpcm-auto-log')?.checked;
      room.autoLogRecentBlocks = Number(overlay.querySelector('#rpcm-auto-log-recent')?.value) || room.autoLogRecentBlocks || APP.defaultRecentLogBlocks;
      room.autoLogRelatedBlocks = Number(overlay.querySelector('#rpcm-auto-log-related')?.value) || room.autoLogRelatedBlocks || APP.defaultRelatedLogBlocks;
      room.autoCharacterDetection = !!overlay.querySelector('#rpcm-auto-char')?.checked;
      room.autoCharacterResetOnReappear = !!overlay.querySelector('#rpcm-auto-char-reset')?.checked;
      room.autoCharacterLibraryId = overlay.querySelector('#rpcm-auto-char-library')?.value || room.autoCharacterLibraryId || '';
      room.maxChars = APP.defaultMaxChars;
    }

    function refreshStatsOnly() {
      readModalIntoRoom();
      const items = room.pending ? activePendingItems(room.pending) : snapshotSelectedItems(room);
      const s = statsForItems(items);
      const max = Number(room.maxChars) || APP.defaultMaxChars;
      const status = statusForChars(s.block, max);
      const mainStrong = overlay.querySelector('.rpcm-summary-main strong');
      if (mainStrong) mainStrong.textContent = `${formatCount(s.block)} / 45,000자`;
      const summaryCount = overlay.querySelector('.rpcm-summary-count');
      if (summaryCount) summaryCount.textContent = `${s.count}개 항목`;
      const breakdownEl = overlay.querySelector('.rpcm-breakdown');
      if (breakdownEl) breakdownEl.innerHTML = contextBreakdown(items).map(x => `<span class="rpcm-breakdown-chip"><strong>${esc(x.label)}</strong><span>${x.count}개 · ${formatCount(x.chars)}자</span></span>`).join('');
      const gauge = overlay.querySelector('.rpcm-gauge');
      if (gauge) {
        gauge.className = `rpcm-gauge ${status.cls}`;
        const bar = gauge.querySelector('span');
        if (bar) bar.style.width = `${Math.max(1, Math.min(100, status.ratio * 100))}%`;
      }
      const statusEl = overlay.querySelector('.rpcm-summary-status');
      if (statusEl) { statusEl.textContent = status.label; statusEl.style.color = status.color; }
      const arm = overlay.querySelector('#rpcm-arm');
      if (arm && !room.pending) arm.disabled = !s.count || s.block > max;
    }

    if (previousScrollTop != null) {
      requestAnimationFrame(() => {
        const nextBody = overlay.querySelector('.rpcm-body');
        if (nextBody) nextBody.scrollTop = previousScrollTop;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // SPA / initialization
  // ---------------------------------------------------------------------------

  async function ensureCurrentRoom(apiChatId, force = false) {
    const epoch = ++state.routeEpoch;
    if (!apiChatId) {
      state.currentChatId = null; state.currentApiChatId = null; state.currentRoom = null; updateFab(); return;
    }
    const roomKey = getRoomScopeKey(apiChatId);
    if (!force && state.currentChatId === roomKey && state.currentRoom) return;
    state.currentChatId = roomKey; state.currentApiChatId = apiChatId;
    // 방 메타 API가 느려도 진입 버튼부터 즉시 표시합니다. 실제 모달 데이터는 아래 초기화 완료 후 엽니다.
    ensureManagerButton(); updateFab();
    const room = await getRoom(roomKey, apiChatId);
    room.apiChatId = apiChatId;
    room.maxChars = APP.defaultMaxChars;
    const characterId = getCharacterIdFromPath();
    if (characterId && room.characterScopeId !== characterId) room.characterScopeId = characterId;
    const meta = await fetchRoomMeta(apiChatId);
    if (epoch !== state.routeEpoch || getRoomScopeKey(getChatIdFromPath(), location.href) !== roomKey) return;
    if (!room.label && meta.label) room.label = meta.label;
    const ids = [...new Set([characterId, room.characterScopeId, ...(room.characterScopeIds || []), ...(meta.characterScopeIds || [])].filter(Boolean).map(String))];
    room.characterScopeIds = ids;
    await saveRoom(room);
    if (epoch !== state.routeEpoch || getRoomScopeKey(getChatIdFromPath(), location.href) !== roomKey) return;
    state.currentRoom = room;
    ensureManagerButton(); updateFab(); sanitizeRenderedContextSoon();
  }

  async function routeTick() {
    const href = location.href;
    const apiChatId = getChatIdFromPath();
    const roomKey = apiChatId ? getRoomScopeKey(apiChatId, href) : null;
    if (href !== state.lastUrl || roomKey !== state.currentChatId) {
      state.lastUrl = href;
      await ensureCurrentRoom(apiChatId, true);
      if (state.modal) closeModal();
    }
    // 버튼은 React 재렌더에 대비해 가볍게 재배치하지만, 전체 채팅 DOM 스캔은
    // 관련 Mutation과 실제 라우트 변경 때만 수행합니다.
    ensureManagerButton();
  }

  async function cleanOrphanMarkerInCurrentRoom() {
    // IndexedDB pending이 유실됐더라도 localStorage 이중 백업과 숨김 marker가 남아 있으면 AI 원문을 복원합니다.
    const room = state.currentRoom;
    if (!room || room.pending) return;
    try {
      const backup = loadPendingBackup(room.chatId);
      if (!backup?.messageId || !backup?.originalText) return;
      const current = await fetchMessage(apiChatIdOf(room), backup.messageId);
      if (!current) return;
      const currentText = messageTextOf(current);
      if (!currentText.includes(APP.markerStart) && !currentText.includes(APP.legacyMarkerStart)) {
        clearPendingBackup(room.chatId);
        return;
      }
      room.pending = backup;
      await saveRoom(room);
      await restorePending(room, 'recovery');
      notify('DB 상태가 유실된 숨김 컨텍스트를 로컬 백업으로 안전 복원했습니다.', 'warn', 5500);
    } catch (e) {
      console.warn('[RP매니저] orphan recovery failed', e);
    }
  }

  async function init() {
    try {
      addStyles();
      state.db = await openDb();
      createFab();
      startRenderedContextObserver();
      await ensureCurrentRoom(getChatIdFromPath(), true);
      await cleanOrphanMarkerInCurrentRoom();
      setInterval(() => routeTick().catch(console.warn), 1000);
      setInterval(() => recoveryTick().catch(console.warn), APP.pollMs);
      // 새로고침 후에도 활성 자동 유지 세션을 이어가기 위한 즉시 복구 패스입니다.
      recoveryTick().catch(console.warn);
      console.log(`[위시RPManager] ${APP.name} v${APP.version} loaded`);
    } catch (e) {
      console.error('[RP매니저] init failed', e);
      notify(`🪽위시 RP Manager 초기화 실패: ${e.message}`, 'error', 7000);
    }
  }

  function startCompat() {
    // 독립 폴백 버튼으로 먼저 열 수 있게 하고, 다른 확프/React 툴바가 준비되면
    // routeTick이 충돌 없는 상단 위치로 자동 이동시킵니다.
    setTimeout(() => init(), 250);
  }

  // 화면 숨김 필터는 Manager UI보다 먼저 시작합니다.
  startRenderedContextObserver();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCompat, { once: true });
  } else {
    startCompat();
  }
})();
