import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

export async function testGemini() {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
    Coke Price
    July -Php 10 
    August- Php 13
    
    
    Anlyze the coke price over 2 months, give me final conclusion.`,
  });
  console.log(response.text);
}
