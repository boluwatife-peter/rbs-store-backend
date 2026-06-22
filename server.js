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
   STRIPE
========================= */
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* =========================
   SUPABASE
========================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   TEST ORDER ROUTE
========================= */
app.get("/test-order", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .insert([
        {
          customer_name: "Peter",
          customer_email: "test@example.com",
          product_name: "Test Product",
          quantity: 1,
          total_price: 100,
          status: "pending"
        }
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      message: "Order saved successfully!",
      data
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* =========================
   CREATE CHECKOUT SESSION
========================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const items = req.body.items || [];

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
      return res.status(500).json({
        error: orderError.message
      });
    }

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

    res.json({
      url: session.url
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* =========================
   WEBHOOK
========================= */
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const orderId = session.metadata.order_id;

    await supabase
      .from("orders")
      .update({
        status: "paid"
      })
      .eq("id", orderId);
  }

  res.json({
    received: true
  });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
