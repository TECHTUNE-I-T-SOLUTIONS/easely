import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const audience = searchParams.get("audience") || "all";
    const search = searchParams.get("search");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 200);

    let query = supabaseAdmin
      .from("faqs")
      .select("*")
      .eq("is_active", true)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);

    // Filter by audience
    if (audience && audience !== "all") {
      query = query.or(`audience.eq.${audience},audience.eq.all`);
    }

    // Filter by category
    if (category) {
      query = query.eq("category", category);
    }

    // Search functionality
    if (search) {
      query = query.or(`question.ilike.%${search}%,answer.ilike.%${search}%`);
    }

    const { data: faqs, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group by category for better organization
    const groupedByCategory = (faqs || []).reduce((acc: any, faq: any) => {
      const category = faq.category || "General";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(faq);
      return acc;
    }, {});

    // Get unique categories
    const categories = [...new Set((faqs || []).map((faq: any) => faq.category))];

    return NextResponse.json({
      faqs: faqs || [],
      groupedByCategory,
      categories,
      total: (faqs || []).length,
    });
  } catch (error) {
    console.error("[FAQS][GET]", error);
    return NextResponse.json({ error: "Failed to fetch FAQs" }, { status: 500 });
  }
}
