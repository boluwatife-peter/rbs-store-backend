require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   STRIPE + SUPABASE
========================= */
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   CREATE CHECKOUT SESSION
========================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const items = req.body.items || [];

    // 1. CREATE ORDER FIRST (PENDING)
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          customer_name: req.body.customer_name || "Guest",
          customer_email: req.body.customer_email || "",
          product_name: items.map(i => i.name).join(", "),
          quantity: items.length,
          total_price: items.reduce((sum, i) => sum + i.price, 0),
          status: "pending"
        }
      ])
      .select()
      .single();

    if (orderError) {
      console.log("Supabase error:", orderError.message);
      return res.status(500).json({ error: orderError.message });
    }

    // 2. CREATE STRIPE SESSION
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: items.map(item => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name
          },
          unit_amount: Math.round(item.price * 100)
        },
        quantity: 1
      })),
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
      metadata: {
        order_id: order.id
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.log("Server error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   WEBHOOK (FIXED VERSION)
========================= */
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // PAYMENT SUCCESS
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const orderId = session.metadata.order_id;

    console.log("PAYMENT SUCCESS:", orderId);

    // update Supabase
    const { error } = await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", orderId);

    if (error) {
      console.log("Supabase update error:", error.message);
    }
  }

  res.json({ received: true });
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
