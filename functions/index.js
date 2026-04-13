const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const getEnvValue = (key) => {
  const raw = process.env[key];
  return typeof raw === "string" ? raw.trim() : "";
};

const getRuntimeConfig = () =>
  typeof functions.config === "function" ? functions.config() : {};

const normalizeItems = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const date = String(entry.date ?? "").trim();
      const wasteType = String(entry.wasteType ?? entry.type ?? "").trim();
      if (!date || !wasteType) {
        return null;
      }
      return { date, wasteType };
    })
    .filter(Boolean);
};

exports.trashImport = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    const origin = typeof req.headers.origin === "string"
      ? req.headers.origin
      : "*";

    const setCors = () => {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
    };

    setCors();

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    console.log("trashImport request", {
      method: req.method,
      origin: req.headers.origin ?? null,
      contentType: req.headers["content-type"] ?? null,
    });

    if (req.method !== "POST") {
      setCors();
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const runtimeConfig = getRuntimeConfig();
    const apiKey =
      getEnvValue("OPENAI_API_KEY") ||
      String(runtimeConfig?.openai?.key ?? "").trim();
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY");
      setCors();
      res.status(500).json({ error: "Missing OPENAI_API_KEY" });
      return;
    }

    const body = req.body || {};
    const fileName = String(body.fileName ?? "");
    const mimeType = String(body.mimeType ?? "");
    const dataBase64 = String(body.dataBase64 ?? "");
    const locale = String(body.locale ?? "pl").toLowerCase();

    console.log("trashImport payload", {
      fileName,
      mimeType,
      locale,
      base64Length: dataBase64.length,
    });

    if (!mimeType.startsWith("image/")) {
      setCors();
      res.status(400).json({ error: "Only image uploads are supported" });
      return;
    }

    if (!dataBase64) {
      setCors();
      res.status(400).json({ error: "Missing image data" });
      return;
    }

    const estimatedBytes = Math.floor((dataBase64.length * 3) / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      setCors();
      res.status(413).json({ error: "Image too large" });
      return;
    }

    const model =
      getEnvValue("OPENAI_MODEL") ||
      String(runtimeConfig?.openai?.model ?? "").trim() ||
      DEFAULT_MODEL;
    const dataUrl = `data:${mimeType};base64,${dataBase64}`;

    const prompt =
      "Read the trash pickup schedule from the image and return JSON with items. " +
      "Each item must have date in YYYY-MM-DD and wasteType. " +
      "Use Polish waste type names if the locale is pl, otherwise English. " +
      "If the image shows only a month and day (no year), assume the current year. " +
      "If the image shows month headers and only day numbers in rows/columns, " +
      "extract ALL day numbers and assign them to the correct month and waste type. " +
      "Do NOT skip numbers if they are clearly part of the schedule. " +
      "If multiple dates belong to a single waste type, return each date separately. " +
      "If a day appears without an explicit month but within a month section, " +
      "use that month from the section header.";

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You extract structured pickup dates from images and return strict JSON.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    `${prompt}\nLocale: ${locale}\nFile: ${fileName || "image"}\n` +
                    "Return only JSON with shape {items:[{date,wasteType}], rawText?}.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: dataUrl,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenAI request failed", {
          status: response.status,
          detail: errorText.slice(0, 200),
        });
        setCors();
        res.status(502).json({
          error: "OpenAI request failed",
          detail: errorText.slice(0, 500),
        });
        return;
      }

      const payload = await response.json();
      const content =
        payload?.choices?.[0]?.message?.content ?? "{}";
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        console.error("Invalid OpenAI JSON response", {
          preview: String(content).slice(0, 200),
        });
        setCors();
        res.status(502).json({ error: "Invalid OpenAI JSON response" });
        return;
      }

      const items = normalizeItems(parsed.items ?? parsed.events ?? []);
      const rawText =
        typeof parsed.rawText === "string" ? parsed.rawText : "";

      res.status(200).json({
        items,
        rawText,
        model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCors();
      res.status(500).json({ error: "Import failed", detail: message });
    }
  });

exports.feedbackSubmit = functions
  .region("us-central1")
  .runWith({ memory: "256MB", timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    const origin = typeof req.headers.origin === "string"
      ? req.headers.origin
      : "*";

    const setCors = () => {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
    };

    setCors();

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const runtimeConfig = getRuntimeConfig();
    const gmailUser = String(runtimeConfig?.gmail?.user ?? "").trim();
    const gmailPass = String(runtimeConfig?.gmail?.pass ?? "").trim();
    const feedbackTo =
      String(runtimeConfig?.feedback?.to ?? "").trim() ||
      "wrokam88@gmail.com";

    if (!gmailUser || !gmailPass) {
      res.status(500).json({ error: "Missing Gmail configuration" });
      return;
    }

    const body = req.body || {};
    const subject = String(body.subject ?? "").trim();
    const message = String(body.message ?? "").trim();
    const userUid = String(body.userUid ?? "").trim();
    const userEmail = String(body.userEmail ?? "").trim();
    const appVersion = String(body.appVersion ?? "").trim();
    const platform = String(body.platform ?? "").trim();
    const locale = String(body.locale ?? "").trim();

    if (!subject || !message) {
      res.status(400).json({ error: "Missing subject or message" });
      return;
    }

    const safeSubject = subject.slice(0, 200);
    const safeMessage = message.slice(0, 4000);

    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    const metadata = [
      `userUid: ${userUid || "—"}`,
      `userEmail: ${userEmail || "—"}`,
      `platform: ${platform || "—"}`,
      `locale: ${locale || "—"}`,
      `appVersion: ${appVersion || "—"}`,
    ].join("\n");

    try {
      await transport.sendMail({
        from: gmailUser,
        to: feedbackTo,
        subject: `[Trash Reminder] ${safeSubject}`,
        text: `${safeMessage}\n\n---\n${metadata}`,
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: "Email send failed", detail: message });
    }
  });
