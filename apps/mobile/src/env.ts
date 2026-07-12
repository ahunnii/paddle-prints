const apiUrl = process.env.EXPO_PUBLIC_API_URL;
if (!apiUrl) {
  throw new Error("EXPO_PUBLIC_API_URL is not set (create apps/mobile/.env)");
}
export const env = { EXPO_PUBLIC_API_URL: apiUrl };
