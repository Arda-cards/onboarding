import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedOrder, RawEmail } from "../types";

// Schema for structured output
const ORDER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isOrder: { type: Type.BOOLEAN, description: "True if this email is a receipt, invoice, or order confirmation." },
    supplier: { type: Type.STRING, description: "The name of the vendor or supplier." },
    orderDate: { type: Type.STRING, description: "Date of the order in ISO 8601 format (YYYY-MM-DD)." },
    totalAmount: { type: Type.NUMBER, description: "Total numerical value of the order." },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Clean, standardized name of the product." },
          quantity: { type: Type.NUMBER, description: "Numeric quantity purchased." },
          unit: { type: Type.STRING, description: "Unit of measure (e.g., box, case, each, lbs)." },
          unitPrice: { type: Type.NUMBER, description: "Price per unit." }
        }
      }
    }
  },
  required: ["isOrder"]
};

export const parseEmailWithGemini = async (email: RawEmail, apiKey: string): Promise<ExtractedOrder | null> => {
  if (!apiKey) throw new Error("API Key is missing");

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `
        Analyze the following email content. Determine if it is a purchase order, receipt, or invoice.
        If it is, extract the supplier, date, and line items.
        
        Subject: ${email.subject}
        Sender: ${email.sender}
        Date Header: ${email.date}
        Body:
        ${email.body}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: ORDER_SCHEMA,
      }
    });

    const text = response.text;
    if (!text) return null;

    const data = JSON.parse(text);

    if (!data.isOrder) {
      return null;
    }

    return {
      id: `order_${Math.random().toString(36).substr(2, 9)}`,
      originalEmailId: email.id,
      supplier: data.supplier || "Unknown Supplier",
      orderDate: data.orderDate || email.date,
      totalAmount: data.totalAmount,
      items: data.items || [],
      confidence: 0.95 
    };

  } catch (error) {
    console.error("Gemini Parsing Error:", error);
    return null;
  }
};

/**
 * Uses Gemini to take a rough email draft and make it more professional and concise.
 */
export const improveEmailDraft = async (body: string, apiKey: string): Promise<string> => {
  if (!apiKey) throw new Error("API Key is missing for AI Enhancement");

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `
        Rewrite the following email draft to be professional, polite, and concise. 
        It is a supplier communication for a business. 
        Keep any specific numbers, dates, or product names.
        Return ONLY the rewritten body text.
        
        Draft:
        ${body}
      `,
    });

    return response.text || body;
  } catch (error) {
    console.error("Gemini Improvement Error:", error);
    return body; // Fallback to original
  }
};
