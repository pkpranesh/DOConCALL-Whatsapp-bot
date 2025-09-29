require("dotenv").config();
const express = require("express");
const { urlencoded } = require("express");
const { MessagingResponse } = require("twilio").twiml;
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  ASSEMBLYAI_API_KEY,
  ROBOFLOW_API_KEY,
  ROBOFLOW_MODEL_ID,
  ROBOFLOW_MODEL_VERSION,
  OPENROUTER_API_KEY,
} = process.env;

const app = express();
app.use(urlencoded({ extended: false }));

// --- Helper: sleep/delay ---
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- OpenRouter ---
async function askOpenRouter(prompt) {
  try {
    console.log("🔵 Sending prompt to OpenRouter:", prompt);

    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "deepseek/deepseek-r1", // ✅ free model
        messages: [
          {
            role: "system",
            content:
              "You are a medical triage assistant. Analyze the input (symptoms, description, or detected skin disease). Classify into severity: 🔴 RED (urgent, needs doctor immediately), 🟡 YELLOW (moderate, monitor closely), 🟢 GREEN (mild, home care). Provide immediate next steps clearly. KEEP THE OUTPUT SHORT (100–150 words). FIRST include the COLOR + disease name, then instructions.",
          },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = res.data.choices[0].message.content;
    console.log("✅ OpenRouter reply:", reply);
    return reply;
  } catch (err) {
    console.error("❌ OpenRouter error:", err.response?.data || err.message);
    return "Error analyzing condition.";
  }
}

// --- Roboflow (Image Processing) ---
async function describeImageWithRoboflow(mediaUrl) {
  try {
    console.log("🔵 Roboflow: Downloading image from Twilio...");
    const image = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
    });

    const form = new FormData();
    form.append("file", Buffer.from(image.data), "upload.jpg");

    const url = `https://detect.roboflow.com/${ROBOFLOW_MODEL_ID}/${ROBOFLOW_MODEL_VERSION}?api_key=${ROBOFLOW_API_KEY}`;
    console.log(`🔵 Sending image to Roboflow: ${url}`);

    const res = await axios.post(url, form, { headers: form.getHeaders() });
    console.log("✅ Roboflow raw response:", JSON.stringify(res.data, null, 2));

    const predictions = res.data?.predictions || [];
    if (!predictions.length) {
      return "No skin condition detected.";
    }

    const objects = [...new Set(predictions.map((p) => p.class || p.label))];
    console.log("✅ Detected skin conditions:", objects);

    return await askOpenRouter(
      `Detected possible skin disease(s): ${objects.join(
        ", "
      )}. Classify severity and suggest immediate action.`
    );
  } catch (err) {
    console.error("❌ Roboflow error:", err.response?.data || err.message);
    return "Error detecting objects in the image.";
  }
}

// --- AssemblyAI (Voice Processing) ---
async function transcribeWithAssemblyAI(mediaUrl) {
  try {
    console.log("🔵 AssemblyAI: Downloading audio from Twilio...");
    const response = await axios.get(mediaUrl, {
      responseType: "stream",
      auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
    });

    const filePath = path.join(__dirname, "temp.ogg");
    await new Promise((r) =>
      response.data.pipe(fs.createWriteStream(filePath)).on("finish", r)
    );
    console.log("✅ Audio file saved locally:", filePath);

    const fileData = fs.readFileSync(filePath);
    const uploadRes = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      fileData,
      {
        headers: { authorization: ASSEMBLYAI_API_KEY },
      }
    );
    fs.unlinkSync(filePath);

    console.log("✅ Audio uploaded. URL:", uploadRes.data.upload_url);

    const transcriptRes = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      { audio_url: uploadRes.data.upload_url },
      { headers: { authorization: ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptRes.data.id;
    console.log("🔵 Transcript request created. ID:", transcriptId);

    while (true) {
      const poll = (
        await axios.get(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          { headers: { authorization: ASSEMBLYAI_API_KEY } }
        )
      ).data;

      console.log("🔄 Polling AssemblyAI status:", poll.status);

      if (poll.status === "completed") {
        console.log("✅ Final transcript:", poll.text);
        return await askOpenRouter(
          `Patient audio report: ${poll.text}. Classify severity and suggest immediate action.`
        );
      }
      if (poll.status === "failed") {
        return "Failed to transcribe audio.";
      }
      await sleep(3000);
    }
  } catch (err) {
    console.error("❌ AssemblyAI error:", err.response?.data || err.message);
    return "Error transcribing audio.";
  }
}

// --- WhatsApp Webhook ---
app.post("/whatsapp", async (req, res) => {
  const twiml = new MessagingResponse();

  try {
    const numMedia = parseInt(req.body.NumMedia || "0");
    const mediaType = (req.body.MediaContentType0 || "").toLowerCase();
    const mediaUrl = req.body.MediaUrl0 || null;

    console.log("📩 Incoming WhatsApp message:", {
      body: req.body.Body,
      numMedia,
      mediaType,
      mediaUrl,
    });

    if (numMedia > 0 && mediaUrl) {
      // ✅ Acknowledge immediately (avoid Twilio timeout)
      twiml.message("Processing your request... Please wait.");
      res.type("text/xml").send(twiml.toString());

      // Process media async and reply back
      let result;
      if (mediaType.startsWith("image")) {
        result = await describeImageWithRoboflow(mediaUrl);
      } else if (mediaType.startsWith("audio")) {
        result = await transcribeWithAssemblyAI(mediaUrl);
      } else {
        result = "Unsupported media type.";
      }

      // Add delay before sending the reply
      await sleep(1500); // 1.5 seconds delay

      // Send follow-up message via Twilio REST API
      const client = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: req.body.To,
        to: req.body.From,
        body: result,
      });

      console.log("📤 Sent async response:", result);
      return;
    }

    // ✅ Text input (instant reply)
    const result = await askOpenRouter(
      `Patient message: ${req.body.Body}. Classify severity and suggest immediate action.`
    );

    // Optional delay before sending text reply
    await sleep(1000); // 1 second delay

    twiml.message(result);
    res.type("text/xml").send(twiml.toString());
    console.log("📤 Replying to user:", result);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    twiml.message("Error processing your message.");
    res.type("text/xml").send(twiml.toString());
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));