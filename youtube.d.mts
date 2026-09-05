export function extractYouTubeVideoId(input: string): string | null;
export function getYouTubeMetadata(input: string): Promise<{
  videoId: string;
  url: string;
  title: string;
  authorName: string | null;
  authorUrl: string | null;
  artworkUrl: string;
  artworkFallbackUrl: string;
  source: string;
}>;