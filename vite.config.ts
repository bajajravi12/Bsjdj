import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'api-routes',
        configureServer(server) {
          server.middlewares.use('/api/generate', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              return res.end(JSON.stringify({ error: 'Method not allowed' }));
            }

            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });

            req.on('end', async () => {
              try {
                const parsed = JSON.parse(body || '{}');
                const { prompt, systemInstruction } = parsed;

                if (!prompt) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify({ error: 'Prompt is required' }));
                }

                const apiKey = process.env.GEMINI_API_KEY;
                if (!apiKey) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify({ error: 'GEMINI_API_KEY environment variable missing' }));
                }

                const ai = new GoogleGenAI({
                  apiKey,
                  httpOptions: {
                    headers: {
                      'User-Agent': 'aistudio-build',
                    },
                  },
                });

                const response = await ai.models.generateContent({
                  model: 'gemini-3.6-flash',
                  contents: prompt,
                  config: systemInstruction ? { systemInstruction } : undefined,
                });

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ text: response.text }));
              } catch (err: any) {
                console.error('Vite API route error:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: err?.message || 'Failed to generate response' }));
              }
            });
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      'import.meta.env.VITE_APK_DOWNLOAD_URL': JSON.stringify(process.env.VITE_APK_DOWNLOAD_URL || ''),
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
