import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import { authSecret } from "@/lib/auth-secret";

const handler = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "text" },
        phone: { label: "Phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.password) {
          return null;
        }

        try {
          let user;

          if (credentials.email) {
            const { data } = await supabase
              .from("users")
              .select("*")
              .eq("email", credentials.email)
              .single();
            user = data;
          } else if (credentials.phone) {
            const { data } = await supabase
              .from("users")
              .select("*")
              .eq("phone_number", credentials.phone)
              .single();
            user = data;
          }

          if (!user) {
            return null;
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password_hash
          );

          if (!isPasswordValid || user.status !== "active") {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            phone_number: user.phone_number,
            role: user.role,
            status: user.status,
            image: user.profile_picture_url,
            profilePictureUrl: user.profile_picture_url,
            profileComplete: user.profile_complete,
            createdAt: user.created_at,
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.phone = user.phone;
        token.role = user.role;
        token.email = user.email;
        token.profilePictureUrl = user.profilePictureUrl;
        token.profileComplete = user.profileComplete;
        token.createdAt = user.createdAt;
        token.status = user.status;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session?.user) {
        session.user.id = token.id;
        session.user.firstName = token.firstName;
        session.user.lastName = token.lastName;
        session.user.phone = token.phone;
        session.user.role = token.role;
        session.user.profilePictureUrl = token.profilePictureUrl;
        session.user.profileComplete = token.profileComplete;
        session.user.createdAt = token.createdAt;
        session.user.status = token.status;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: authSecret,
});

export { handler as GET, handler as POST };
