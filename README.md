# MedGraph

MedGraph turns a fragmented medication list into an evidence-grounded safety
graph, backed by RxNorm normalization, openFDA-submitted drug labeling, and a
Gemini extraction + backend-validation layer that verifies every quote before
it's shown.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. **Set up your Gemini API key** (required for live analysis; not required
   for Demo Mode):
   ```bash
   cp .env.example .env.local
   ```
   Then open `.env.local` and paste in a key from
   [Google AI Studio](https://aistudio.google.com/app/apikey):
   ```
   GEMINI_API_KEY=your_key_here
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3005](http://localhost:3005).

If you deploy this (e.g. to Vercel), you must also add `GEMINI_API_KEY` in
your hosting provider's **Environment Variables** settings — `.env.local` is
gitignored and never gets deployed with your code.

If you don't have a key handy, toggle **"Use Demo Data"** on the page — it
replays captured, already-validated fixtures for Warfarin / Aspirin /
Ibuprofen without calling any live API.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
