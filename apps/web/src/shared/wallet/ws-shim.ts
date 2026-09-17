/**
 * isomorphic-ws 대체.
 *
 * midnight-js 인덱서 프로바이더가 `import { WebSocket } from 'isomorphic-ws'`
 * 형태로 named export를 기대하는데, 브라우저 빌드에는 default만 있다.
 * 브라우저에는 전역 WebSocket이 있으므로 그걸 그대로 내보낸다.
 */
const BrowserWebSocket = globalThis.WebSocket;

export { BrowserWebSocket as WebSocket };
export default BrowserWebSocket;
