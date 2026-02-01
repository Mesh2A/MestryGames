import AppleProvider from "next-auth/providers/apple";
import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";

const maxAgeDays = Math.max(1, Math.floor(Number(process.env.AUTH_MAX_AGE_DAYS || 30)));
const maxAgeSeconds = maxAgeDays * 24 * 60 * 60;

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  providers.push(
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt", maxAge: maxAgeSeconds, updateAge: 24 * 60 * 60 },
  jwt: { maxAge: maxAgeSeconds },
};
