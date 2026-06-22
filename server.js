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

/* IMPORTANT: webhook must come BEFORE json parser */

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("Server is running");
});

app.get("/test-order", async (req, res) => {
  const { data, error } = await supabase
    .from("orders")
    .insert([
      {
        customer_name: "Test User",
        customer_email: "test@example.com",
        product_name: "Test Product",
        quantity: 1,
        total_price: 100,
        status: "pending",
      },
    ])
    .select();

  if (error) return res.status(500).json(error);

  res.json({ message: "Inserted", data });
});

/* =========================
   CREATE CHECKOUT SESSION
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
   WEBHOOK (FINAL FIXED VERSION)
========================= */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("🔥 WEBHOOK RECEIVED");

    const signature = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("❌ Stripe signature error:", err.message);
      return res.status(400).send("Webhook Error");
    }

    console.log("EVENT TYPE:", event.type);

    /* =========================
       SUCCESSFUL PAYMENT
    ========================= */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      console.log("SESSION:", session);

      const items = JSON.parse(session.metadata.items || "[]");

      const { data, error } = await supabase
        .from("orders")
        .insert([
          {
            customer_email: session.customer_details?.email || "unknown",
            product_name: items.map((i) => i.name).join(", "),
            quantity: items.length,
            total_price: session.amount_total / 100,
            status: "paid",
            stripe_session_id: session.id,
          },
        ]);

      console.log("SUPABASE INSERT:", data, error);
    }

    res.json({ received: true });
  }
);

/* =========================
   JSON PARSER (AFTER WEBHOOK)
========================= */
app.use(express.json());

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
