/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // dev 인디케이터가 공격 패널의 A1 버튼을 가린다. 발표 중 눌러야 하는 버튼이다.
  devIndicators: false,
};
export default nextConfig;
