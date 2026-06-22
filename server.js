require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =========================
   STRIPE + SUPABASE INIT
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
app.use(express.json());

/* =========================
   TEST ROUTE (SUPABASE CHECK)
========================= */
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

  if (error) {
    return res.status(500).json(error);
  }

  res.json({ message: "Inserted successfully", data });
});

/* =========================
   CREATE CHECKOUT SESSION
========================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const items = req.body.items || [];

    // 1. Create order FIRST in Supabase
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          customer_name: req.body.customer_name || "Guest",
          customer_email: req.body.customer_email || "",
          product_name: items.map((i) => i.name).join(", "),
          quantity: items.length,
          total_price: items.reduce((sum, i) => sum + i.price, 0),
          status: "pending",
        },
      ])
      .select()
      .single();

    if (orderError) {
      return res.status(500).json({ error: orderError.message });
    }

    // 2. Create Stripe session
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
        order_id: order.id, // IMPORTANT
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   WEBHOOK (FIXED VERSION)
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
      console.log("❌ Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("Event type:", event.type);

    // =========================
    // PAYMENT SUCCESS
    // =========================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      console.log("SESSION:", session);

      const orderId = session.metadata.order_id;

      const { data, error } = await supabase
        .from("orders")
        .update({
          status: "paid",
        })
        .eq("id", orderId);

      console.log("Supabase update result:", data, error);
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
