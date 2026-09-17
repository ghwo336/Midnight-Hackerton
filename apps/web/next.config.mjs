/** @type {import('next').NextConfig} */
/**
 * 백엔드 주소. 프록시 대상일 뿐 브라우저에 노출되지 않는다.
 * 원격 배포에서는 이 값만 바꾸면 된다.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3011';

const nextConfig = {
  reactStrictMode: true,

  /**
   * API 를 같은 출처로 끌어온다.
   *
   * 예전에는 페이지가 :3040, API 가 :3011 이라 브라우저가 교차 출처
   * 요청을 했다. 그런데 광고·프라이버시 확장 중에는 "웹페이지가 localhost
   * 의 다른 포트로 보내는 요청"을 포트 스캔으로 보고 막는 것들이 있다.
   * 막힌 요청은 거부도 CORS 오류도 아니고 **무응답**이라, 화면은 값이
   * 전부 '—' 인 채로 멈추고 서버 로그에는 아무것도 남지 않는다.
   * 원인을 추적할 단서가 없는 형태로 실패한다.
   *
   * 프록시를 두면 브라우저는 페이지를 이미 성공적으로 받아온 :3040 하고만
   * 통신한다. CORS 도 preflight 도 필요 없어진다. 심사위원이 어떤 확장을
   * 켜 두었든 같은 결과가 나온다.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  // dev 인디케이터가 공격 패널의 A1 버튼을 가린다. 발표 중 눌러야 하는 버튼이다.
  devIndicators: false,

  webpack: (config, { isServer }) => {
    /*
     * Midnight 런타임은 WASM이다.
     *
     * compact-runtime → onchain-runtime-v3 → .wasm 을 거치는데 webpack5는
     * WASM을 기본으로 켜지 않는다. 브라우저에서 회로를 돌리려면 필요하다.
     */
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true };

    /*
     * 워크스페이스 패키지(@once/witness, @once/domain)는 컴파일하지 않고
     * TS 소스를 그대로 쓴다. 그 안의 import는 NodeNext 규칙에 따라 './x.js'
     * 라고 적혀 있는데 실제 파일은 './x.ts'다. webpack에 그 대응을 알려준다.
     *
     * 이 패키지들을 컴파일된 JS로 바꾸지 않는 이유: witness 구현은 Node
     * 시뮬레이터와 브라우저가 **같은 파일**을 써야 한다. 빌드 산출물을
     * 중간에 끼우면 어느 쪽이 무엇을 쓰는지가 흐려진다.
     */
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };

    /*
     * midnight-js-indexer-public-data-provider가 isomorphic-ws에서
     * named export WebSocket을 가져오는데 브라우저 빌드에는 그게 없다.
     * 브라우저에는 전역 WebSocket이 있으므로 그걸 쓰게 한다.
     */
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...config.resolve.alias,
        'isomorphic-ws': new URL('./src/shared/wallet/ws-shim.ts', import.meta.url).pathname,
      };
      // WASM은 서버 번들에 넣지 않는다
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    }
    return config;
  },
};
export default nextConfig;
