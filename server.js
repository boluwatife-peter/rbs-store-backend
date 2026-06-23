require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =========================
   INIT
========================= */
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json()); // IMPORTANT for normal routes

/* =========================
   HOME
========================= */
app.get("/", (req, res) => {
  res.send("Server running");
});

/* =========================
   GET ORDERS (PAID PAGE USES THIS)
========================= */
app.get("/orders", async (req, res) => {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  res.json({ data, error });
});

/* =========================
   DEBUG SUPABASE
========================= */
app.get("/debug-supabase", async (req, res) => {
  const { data, error } = await supabase.from("orders").select("*");
  res.json({ data, error });
});

/* =========================
   STRIPE CHECKOUT
========================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const items = req.body.items || [];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: items.map((item) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: 1,
      })),

      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,

      metadata: {
        items: JSON.stringify(items),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   STRIPE WEBHOOK (IMPORTANT)
========================= */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("🔥 WEBHOOK HIT");

    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("❌ Signature error:", err.message);
      return res.status(400).send("Webhook Error");
    }

    console.log("EVENT TYPE:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      let items = [];

      try {
        items = session.metadata?.items
          ? JSON.parse(session.metadata.items)
          : [];
      } catch (err) {
        console.log("❌ Metadata parse error:", err.message);
      }

      const insertData = {
        customer_email: session.customer_details?.email || "unknown",
        product: items,
        total: (session.amount_total || 0) / 100,
        payment_status: "paid",
      };

      console.log("INSERT DATA:", insertData);

      const { data, error } = await supabase
        .from("orders")
        .insert([insertData])
        .select();

      console.log("SUPABASE DATA:", data);
      console.log("SUPABASE ERROR:", error);
    }

    res.json({ received: true });
  }
);

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
