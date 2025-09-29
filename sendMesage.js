// sendMessage.js


const client = require('twilio')(accountSid, authToken);

client.messages
  .create({
     from: 'whatsapp:', // Twilio Sandbox number
     body: 'Hello from Node.js and Twilio!',
     to: 'whatsapp:'   // Your WhatsApp number (e.g., +91 for India)
   })
  .then(message => console.log('Message sent! SID:', message.sid))
  .catch(error => console.error('Error:', error));