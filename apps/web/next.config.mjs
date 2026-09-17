/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
