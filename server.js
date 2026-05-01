require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Route for chat completions
app.post('/api/chat', async (req, res) => {
  try {
    const { model, messages, temperature } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'Groq API Key is not configured on the server.' });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages,
        temperature: temperature || 0.75,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API Error:', errText);
      return res.status(response.status).json({ error: `Groq API Error: ${response.statusText}` });
    }

    // Set headers for streaming SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Stream the response back to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        break;
      }
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    console.error('Server Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error while communicating with Groq API.' });
    } else {
      res.end();
    }
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
