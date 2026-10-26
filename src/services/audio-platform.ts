export function requiresNativeAudio(
  platform: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator,
) {
  // iPadOS can identify itself as a Macintosh when requesting desktop sites.
  return (
    /iPhone|iPad|iPod/.test(platform.userAgent) ||
    (/Macintosh/.test(platform.userAgent) && platform.maxTouchPoints > 1)
  );
}
