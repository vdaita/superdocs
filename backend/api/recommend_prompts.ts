// @ts-nocheck

import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { distance, closest } from 'fastest-levenshtein';
import { jwtVerify } from 'jose';
import { getFixedSearchReplace } from '../utils/diff';
import { AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT, PLAN_PROMPT, PLAN_PROMPT_BULLET_POINTS } from '../utils/prompts';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

// @ts-ignore
// import process from 'process';

// @ts-ignore
import { Transform, TransformCallback } from 'stream'; 

// console.log("Hello via Node!");

export const config = {
    runtime: 'edge'
};

const together = new OpenAI({
    baseURL: "https://api.together.xyz/",
    apiKey: process.env.TOGETHER_API_KEY
});

const groq = new Groq(
    {
        apiKey: process.env.GROQ_API_KEY
    }
)
const openai = new OpenAI();
const googleGenAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

const geminiFlash = googleGenAI.getGenerativeModel({model: 'gemini-1.5-flash-latest', generationConfig: {
    "responseMimeType": "application/json"
}});

type Plan = {
    message: string
    editInstructions: EditInstruction[]
    // newFiles: NewFile[]
}

type EditInstruction = {
    instruction: string
    // filepath: string
    changesCompleted: boolean
    changeUpdate?: string
    changes?: Change[]
}

type Change = {
    filepath: string
    searchBlock: string
    replaceBlock: string
}

type NewFile = {
    filepath: string,
    code: string
}

type Snippet = {
    filepath: string
    code: string
    language: string
  }

type Update = {
    executionIndex: number,
    newEditInstruction: EditInstruction
}

// type Update = {
//     section: "plan" | "change"
//     planId: number
//     instructionId?: number
//     type: "update" | "completion"
//     content: string | Plan | Change
// }

const planSchema = z.object({
    message: z.string().describe("An markdown-formatted change to the user for general purposes (summarizing, general messages, explanation, etc.)"),
    editInstructions: z.array(z.string()).describe("A list of instructions that will be executed in parallel that should edit files.")
});

const CORS_HEADERS = {
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
    },
};

function parseBulletPointPlan(input: string) {
    // Split the input by newline characters
    const lines = input.split('\n');
    
    // Initialize variables for top message and submessages
    let topMessage = '';
    const subMessages: string[] = [];
    
    // Flag to identify if top message has been set
    let topMessageSet = false;
    
    // Iterate over each line
    lines.forEach(line => {
        if (line.startsWith('- ')) {
            // If the line starts with a hyphen, add it to submessages with bullet point
            subMessages.push('• ' + line.substring(2));
        } else {
            // If top message is not yet set, set it to the current line
            if (!topMessageSet) {
                topMessage = line;
                topMessageSet = true;
            } else {
                // If top message is already set, append the line to it with a space
                topMessage += ' ' + line;
            }
        }
    });

    return {
        topMessage,
        subMessages
    };
}

const POST = async (req: VercelRequest) => {
    // console.log("Full request: ", req);

    const url = new URL(req.url!);
    console.log("Received request to: ", req.url);

    if (req.method === "OPTIONS"){
        console.log("Options request received");
        const res = new Response('Departed', CORS_HEADERS);
        return res;
    }

    // console.log("Request body: ", req.body);
    const reqJson = await req.json();

    let message = await groq.chat.completions.create({
        model: "llama3-8b-8192",
        messages: [{
            "role": "system",
            "content": `Based on the most recent changes the user has been making to their file, please try to predict the current objective they are trying to complete. Format your output in JSON: 
            {
                "possibleQueries": [
                    "Query 1",
                    "Query 2"
                ]
            }`
        }, {
            "role": "user",
            "content": `File contents:\n${reqJson['workspaceFiles']}\nMost recent changes: ${reqJson['changes']}`
        }],
        response_format: {
            type: "json_object"
        }
    });
    message = message.choices[0].message.content;
    message = JSON.parse(message);

    return new Response({
        possibleQueries: message["possibleQueries"]
    }, CORS_HEADERS);
}

export default POST;