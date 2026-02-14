import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import DiscordProvider from "next-auth/providers/discord";
import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { ensureDbReady } from "@/lib/ensureDb";
import { notifyDiscord } from "@/lib/discord";
import { ensureGameProfile } from "@/lib/gameProfile";

function normalizeIdentifier(input: string) {
  const raw = String(input || "").trim();
  const cleaned = raw.replace(/\s+/g, "");
  const lower = cleaned.toLowerCase();
  const isEmail = lower.includes("@");
  return { isEmail, value: lower };
}

const maxAgeDays = Math.max(1, Math.floor(Number(process.env.AUTH_MAX_AGE_DAYS || 30)));
const maxAgeSeconds = maxAgeDays * 24 * 60 * 60;

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Credentials",
    credentials: {
      identifier: { label: "Username or email", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      try {
        await ensureDbReady();
      } catch {
        return null;
      }
      const identifier = typeof credentials?.identifier === "string" ? credentials.identifier : "";
      const password = typeof credentials?.password === "string" ? credentials.password : "";
      if (!identifier || !password) return null;

      const normalized = normalizeIdentifier(identifier);
      const where = normalized.isEmail
        ? {
            OR: [{ email: normalized.value }, { contactEmail: normalized.value }],
            passwordHash: { not: null },
          }
        : { username: normalized.value, passwordHash: { not: null } };

      const profile = await prisma.gameProfile.findFirst({ where, orderBy: { createdAt: "desc" } });
      if (!profile?.passwordHash) return null;
      if (!verifyPassword(password, profile.passwordHash)) return null;

      return {
        id: profile.id,
        email: profile.email,
        name: profile.username || profile.email,
      };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    })
  );
}

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  providers.push(
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
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
  callbacks: {
    async signIn({ user, account }) {
      const provider = typeof account?.provider === "string" ? account.provider : "";
      if (provider !== "discord") return true;
      const email = typeof user?.email === "string" ? user.email : "";
      if (!email) return false;
      try {
        await ensureDbReady();
        const profile = await prisma.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const state = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
        const blocked = "discordUnlinkedAt" in state && !!state.discordUnlinkedAt;
        return !blocked;
      } catch {
        return true;
      }
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      if (user?.name) token.name = user.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") session.user.email = token.email;
      if (session.user && typeof token.name === "string") session.user.name = token.name;
      return session;
    },
  },
  events: {
    async signIn({ user, account, isNewUser }) {
      const email = typeof user?.email === "string" ? user.email : "";
      const name = typeof user?.name === "string" ? user.name : "";
      const provider = typeof account?.provider === "string" ? account.provider : "";
      if (provider === "discord" && email) {
        try {
          await ensureDbReady();
          await ensureGameProfile(email);
          await prisma.$transaction(async (tx) => {
            const row = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
            const state = row?.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
            const next = { ...state, discordLinkedAt: Date.now(), lastWriteAt: Date.now() } as Record<string, unknown>;
            if ("discordUnlinkedAt" in next) delete next.discordUnlinkedAt;
            await tx.gameProfile.update({ where: { email }, data: { state: next as Prisma.InputJsonValue } });
          });
        } catch {}
      }
      await notifyDiscord("signin", {
        title: isNewUser ? "New sign-in (first time)" : "User signed in",
        email,
        fields: [
          { name: "Name", value: name || "—", inline: true },
          { name: "Provider", value: provider || "—", inline: true },
        ],
      });
    },
    async createUser({ user }) {
      const email = typeof user?.email === "string" ? user.email : "";
      const name = typeof user?.name === "string" ? user.name : "";
      await notifyDiscord("signup", {
        title: "User created (OAuth)",
        email,
        fields: [{ name: "Name", value: name || "—", inline: true }],
      });
    },
  },
  pages: {
    signIn: "/",
  },
};
