import { createClient } from "@supabase/supabase-js";

if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const serverSupabaseKey = supabaseServiceRoleKey || supabaseAnonKey;

// Client-side Supabase instance (limited access)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase instance (full access - for API routes only)
// Uses service role key when available; falls back to anon key to avoid null references.
export const supabaseAdmin = createClient(supabaseUrl, serverSupabaseKey);

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          phone_number: string;
          email: string;
          role: "user" | "driver" | "admin" | "super_admin";
          status: "active" | "suspended" | "pending";
          emergency_contact: string | null;
          emergency_phone: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      drivers: {
        Row: {
          id: string;
          user_id: string;
          vehicle_type: string | null;
          plate_number: string | null;
          operating_zones: string[];
          union_name: string | null;
          availability_status: "online" | "offline" | "busy";
          bank_name: string | null;
          bank_account_number: string | null;
          emergency_contact: string | null;
          verified: boolean;
          created_at: string;
        };
      };
      admins: {
        Row: {
          id: string;
          user_id: string;
          admin_level: "support" | "ops" | "finance" | "super";
          department: string;
          crm_enabled: boolean;
          crm_meta: Record<string, unknown>;
          permissions: Record<string, boolean>;
          created_at: string;
        };
      };
      wallets: {
        Row: {
          id: string;
          user_id: string;
          balance: number;
          currency: string;
          created_at: string;
          updated_at: string;
        };
      };
      rides: {
        Row: {
          id: string;
          rider_id: string;
          pickup_zone: string;
          pickup_description: string | null;
          destination_zone: string;
          destination_description: string | null;
          ride_type: "single" | "shared" | "delivery";
          fare_amount: number | null;
          status: "pending" | "dispatched" | "accepted" | "in_progress" | "completed" | "cancelled";
          assigned_driver_id: string | null;
          created_at: string;
          completed_at: string | null;
          updated_at: string;
        };
      };
      transactions: {
        Row: {
          id: string;
          wallet_id: string;
          amount: number;
          transaction_type: "credit" | "debit" | "payout" | "refund";
          reference: string | null;
          source: "ride" | "admin_adjustment" | "payout" | "deposit";
          status: "pending" | "completed" | "failed";
          created_at: string;
          updated_at: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          message: string;
          type: "system" | "ride" | "payment" | "admin";
          channel: "in_app" | "push" | "sms" | "email";
          related_table: string | null;
          related_id: string | null;
          read: boolean;
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
};
