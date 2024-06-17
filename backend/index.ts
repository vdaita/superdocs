import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { distance, closest } from 'fastest-levenshtein';
import { jwtVerify } from 'jose';
import { getFixedSearchReplace } from './diff';
import { AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT, PLAN_PROMPT, PLAN_PROMPT_BULLET_POINTS } from './prompts';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";

console.log("Hello via Bun!");
const together = new OpenAI({
    baseURL: "https://api.together.xyz/",
    apiKey: process.env.TOGETHER_API_KEY
});
const groq = new Groq();
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

Bun.serve({
    port: 3001,
    async fetch(req) {

        const url = new URL(req.url);
        console.log("Full request: ", req);

        if (req.method === "OPTIONS"){
            const res = new Response('Departed', CORS_HEADERS);
            return res;
        }

        if(url.pathname === "/get_changes") {
            console.log("Request body: ", req.body);
            const reqJson = await req.json();
            let snippets: Snippet[] = reqJson["snippets"];
            let filepaths: string[] = [];
            snippets.forEach((snippet) => { filepaths.push(snippet.filepath); });
            
            let unifiedSnippets: Snippet[] = [];
            let files = new Map();
            filepaths.forEach((filepath) => {
                let codeChunks: string[] = [];
                let lang: string = "";            
                snippets.forEach((snippet) => {
                    if(snippet.filepath === filepath) {
                        codeChunks.push(snippet.code);
                        lang = snippet.language;
                    }
                });
                unifiedSnippets.push({
                    filepath: filepath,
                    code: codeChunks.join("\n----\n"),
                    language: lang
                });
                files.set(filepath, codeChunks.join("\n----\n"));
            });
    
            let fileContextStr = "";
            unifiedSnippets.forEach((snippet) => {
                fileContextStr += `[${snippet.filepath}]\n \`\`\`\n${snippet.code}\n\`\`\`\n`
            });
    
            // try {
            //     const user = await jwtVerify(
            //         reqJson["session"]["accessToken"],
            //         new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
            //     );
            //     // Either user is verified or this fails.
            // } catch (e) {
            //     console.error("Token validation failed: ", e);
            //     throw "Token validation failed.";
            // }
    
            const stream = new ReadableStream({
                async start(controller) {
                    let planResponse = await openai.chat.completions.create({
                        messages: [{
                            role: "system",
                            content: PLAN_PROMPT_BULLET_POINTS
                        }, {
                            role: "user",
                            content: `Files: ${fileContextStr} \n \nRequest: ${reqJson['request']}`
                        }],
                        model: "gpt-4o",
                        stream: true
                    });
                    let plan: Plan = {
                        message: "",
                        editInstructions: [],
                    }; 
                    let planText = "";
                    for await(const chunk of planResponse) {
                        planText += chunk.choices[0]?.delta?.content || "";
                        let bpPlan = parseBulletPointPlan(planText);
                        let newPlan: Plan = {
                            message: bpPlan.topMessage,
                            editInstructions: []
                        }                        
                        bpPlan.subMessages.forEach((inst) => {
                            newPlan.editInstructions.push({
                                instruction: inst,
                                changesCompleted: false
                            });
                        });
                        plan = newPlan;
                        controller.enqueue(JSON.stringify([plan]) + "<SDSEP>");
                    }

                    // let planResponse = await together.chat.completions.create({
                    //     messages: [{
                    //         role: "system",
                    //         content: PLAN_PROMPT}, 
                    //     {
                    //         role: "user",
                    //         content: `Files: ${fileContextStr} \n \nRequest: ${reqJson['request']}`
                    //     }],
                    //     // model: "mixtral-8x7b-32768",
                    //     // response_format: { type: "json_object" }
                    //     // @ts-ignore for Together schema
                    //     response_format: { type: 'json_object', schema: zodToJsonSchema(planSchema, 'plan')},
                    //     model: "mistralai/Mixtral-8x7B-Instruct-v0.1"
                    // });
                    // let planResult = await geminiFlash.generateContent([`${PLAN_PROMPT}\nFiles: ${fileContextStr}\nRequest: ${reqJson['request']}`]);
                    // let planResponse = planResult.response.text();
                    // for(var i = 0; i < parsedPlanResponse["editInstructions"].length; i++){
                    //     plan.editInstructions.push({
                    //         instruction: parsedPlanResponse["editInstructions"][i],
                    //         changesCompleted: false
                    //     })
                    // }
    
                    controller.enqueue(JSON.stringify([plan]));
    
                    let instructionProcessingRequests = [];
                    
                    for(var i = 0; i < plan.editInstructions.length; i++) {
                        instructionProcessingRequests.push(new Promise<EditInstruction>(async () => {
                            let newInstruction: EditInstruction = {
                                instruction: plan.editInstructions[i].instruction, 
                                changesCompleted: true,
                                changes: []
                            };
    
                            try {
                                const instResponse = await openai.chat.completions.create({
                                    messages: [
                                        {
                                            "role": "system",
                                            "content": AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT
                                        },
                                        {
                                            "role": "user",
                                            "content": fileContextStr + `\n Implement the following and the following only. Other required steps will be completed elsewhere. Instruction: ${plan.editInstructions[i].instruction}`
                                        }
                                    ],
                                    model: "gpt-4o",
                                    stream: true
                                });
                                
                                let diffMd = "";
                                for await(const chunk of instResponse) {
                                    diffMd += chunk.choices[0]?.delta?.content || "";
                                }
                                plan.editInstructions[i].changeUpdate = diffMd;
                                controller.enqueue(JSON.stringify([plan]));

                                let fixedSearchReplaces = getFixedSearchReplace(files, diffMd);
                                fixedSearchReplaces.forEach((fsr) => {
                                    newInstruction.changes?.push({
                                        filepath: fsr.filepath,
                                        searchBlock: fsr.searchBlock,
                                        replaceBlock: fsr.replaceBlock
                                    });
                                });
    
                                return newInstruction;
                            } catch (e) {
                                return newInstruction;
                            }
                        }));
                    }
    
                    let changedInstructions: EditInstruction[] = await Promise.all(instructionProcessingRequests);
                    plan.editInstructions = changedInstructions;
    
                    // Send these instructions back 
                    controller.enqueue(JSON.stringify([plan]));
                }
            })
    
            return new Response(stream, CORS_HEADERS);
        }
        return new Response("404!", CORS_HEADERS);
    },
  });