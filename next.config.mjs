/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The engine shells out to ffmpeg and Playwright; neither belongs in a
  // client bundle, and Next will try to trace them without this.
  serverExternalPackages: ["playwright"],
};
