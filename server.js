require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();

/* MIDDLEWARE */
app.use(cors());
app.use(express.json());

/* STRIPE INIT */
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ✅ HOME ROUTE (FIXES "Cannot GET /") */
app.get("/", (req, res) => {
  res.send("RBS Store Backend is running 🚀");
});

/* 💳 CREATE STRIPE CHECKOUT SESSION */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: req.body.items.map(item => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name
          },
          unit_amount: Math.round(item.price * 100)
        },
        quantity: 1
      })),

      success_url: "https://boluwatife-peter.github.io/rbs-shop/",
      cancel_url: "https://boluwatife-peter.github.io/rbs-shop/"
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error("Stripe Error:", error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

/* 🚀 START SERVER (RENDER READY) */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
