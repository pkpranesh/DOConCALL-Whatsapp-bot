# Twilio WhatsApp AI Assistant

A Node.js/Express webhook for WhatsApp (via Twilio) that:

- Image: downloads the image from Twilio, sends it to Roboflow for detection, then summarizes severity and next steps via OpenRouter (DeepSeek).
- Voice: downloads the audio from Twilio, transcribes it with AssemblyAI, then summarizes severity and next steps via OpenRouter.
- Text: routes the message to OpenRouter for triage and next steps.

The server replies immediately to avoid Twilio timeouts and, for media, follows up with an asynchronous second message containing the final analysis.

---

## Project Structure

- `receiveMessage.js` — main Express app with the `/whatsapp` webhook.
- `sendMesage.js` — sample Twilio sender script (please do not hardcode secrets here; use env vars).
- `package.json` — dependencies and scripts.
- `.env` — local environment variables (never commit real secrets to public repos).

---

## Video Demo

Watch a quick demo of the WhatsApp AI Assistant in action:

- Google Drive : https://drive.google.com/file/d/1foCfST3HAQ7QjlMCePyKxTsZFFyCVFVN/view?pli=1


---

## Requirements

- Node.js 18+
- Twilio WhatsApp Sandbox or a verified WhatsApp sender
- Optional but recommended: `ngrok` for exposing your local server to Twilio

---

## Installation

```bash
npm install
```

---

## Environment Variables

Create a `.env` file in the project root with the following keys. Replace placeholders with your own values.

```env
# Twilio (required)
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# AssemblyAI (required for voice transcription)
ASSEMBLYAI_API_KEY=your_assemblyai_api_key

# Roboflow (required for image analysis)
ROBOFLOW_API_KEY=your_roboflow_api_key
ROBOFLOW_MODEL_ID=your_model_id            # e.g. skin-disease-prediction-1ej1a
ROBOFLOW_MODEL_VERSION=your_model_version   # e.g. 6

# OpenRouter (required for AI reasoning and triage)
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxx

# Optional
PORT=3000
```

Security tips:
- Never commit real secrets to version control.
- Rotate any credentials that may have been exposed.

---

## Running the Server

```bash
npm start
# or specify a different port
PORT=4000 npm start
```

Health check:

```bash
curl http://localhost:3000/
```

---

## Expose Locally (ngrok)

Twilio must reach your local server over the public internet.

```bash
ngrok http 3000
```

Copy the HTTPS forwarding URL from ngrok.

---

## Configure Twilio WhatsApp Webhook

1. Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message (or your WhatsApp sender settings).
2. Set the “WHEN A MESSAGE COMES IN” URL to:
   - `https://<your-ngrok-subdomain>.ngrok.io/whatsapp`
3. Method: `POST`
4. Content type: `application/x-www-form-urlencoded`

Send a message to the sandbox (or your WhatsApp-enabled number) to test.

---

## How It Works

1. Twilio forwards incoming WhatsApp messages to `POST /whatsapp`.
2. The server inspects the payload:
   - **Image**: The image is downloaded from Twilio using Basic Auth (Twilio SID + Auth Token). It is then sent to **Roboflow**. The detected conditions are summarized by **OpenRouter** (DeepSeek), returning a short triage message with severity and actions.
   - **Voice**: The audio is downloaded from Twilio using Basic Auth, transcribed by **AssemblyAI**, then summarized by **OpenRouter** into severity and next steps.
   - **Text**: The user’s text is sent to **OpenRouter** to generate triage and next steps.
3. To avoid Twilio’s 15-second webhook timeout, the server immediately responds. For media, it then sends a follow-up message asynchronously via the Twilio REST API with the final result.

---

## Key Endpoints

- `POST /whatsapp` — Twilio webhook for incoming WhatsApp messages.
- `GET /` — Health check (optional; simple status text).

---

## Dependencies

- `express` — Web server
- `twilio` — WhatsApp Messaging + REST client
- `axios` — HTTP client for API calls
- `dotenv` — Loads environment variables
- `@google/generative-ai` (optional in package) — not used in current flow
- `openai` (in package) — not used directly in current flow; primary LLM calls use OpenRouter API

Note: The current reasoning provider is OpenRouter (DeepSeek model) called directly via HTTP using `axios` inside `receiveMessage.js`.

---

## Testing

- Text message: send any text. You should receive triage with severity and steps.
- Image message: send a clear image relevant to your Roboflow model. You should receive detection-based triage.
- Voice note: send an audio/voice note. You should receive transcribed summary + triage.

If you do not receive the async follow-up for media:
- Check server logs.
- Ensure Twilio REST credentials are correct.
- Verify ngrok URL and webhook configuration.

---

## Troubleshooting

- 401 Unauthorized when downloading media
  - Ensure `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set. Media URLs from Twilio require Basic Auth.

- AssemblyAI fails or stays in processing
  - Confirm `ASSEMBLYAI_API_KEY` is valid.
  - Check logs for error messages.

- Roboflow returns no predictions
  - Confirm `ROBOFLOW_MODEL_ID`, `ROBOFLOW_MODEL_VERSION`, and `ROBOFLOW_API_KEY`.
  - Ensure the image content matches your trained model.

- Twilio webhook timeout
  - The server responds immediately, but ensure your server is reachable (via ngrok) and there are no long synchronous tasks blocking the response.

---

## Notes on Production

- Use a persistent, secure file store if you need to retain uploaded media (the sample uses temporary files for audio).
- Add request validation (e.g., Twilio signature validation) before processing.
- Add structured logging and monitoring.
- Consider retry logic for third-party API calls (OpenRouter/Roboflow/AssemblyAI).

---

## License

MIT
