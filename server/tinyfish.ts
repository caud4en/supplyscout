/**
 * TinyFish Web Agent Client
 * Uses the TinyFish API to autonomously navigate real websites and extract data.
 * API: POST https://agent.tinyfish.ai/v1/automation/run-sse
 */

const TINYFISH_BASE_URL = "https://agent.tinyfish.ai/v1";

export interface TinyFishResult {
  success: boolean;
  data: Record<string, any> | null;
  rawText?: string;
  error?: string;
}

/**
 * Run a TinyFish web agent task.
 * Navigates the given URL, performs the described goal, and returns structured JSON.
 */
export async function runAgent(
  url: string,
  goal: string,
  options: { browserProfile?: "stealth" | "default"; proxy?: { country?: string } } = {}
): Promise<TinyFishResult> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY environment variable not set");
  }

  const body: Record<string, any> = { url, goal };
  if (options.browserProfile === "stealth") {
    body.browser_profile = "stealth";
  }
  if (options.proxy) {
    body.proxy_config = { enabled: true, country: options.proxy.country || "US" };
  }

  try {
    const response = await fetch(`${TINYFISH_BASE_URL}/automation/run-sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TinyFish API error ${response.status}: ${errorText}`);
    }

    // Parse SSE stream — TinyFish streams events over the connection
    // We buffer the full text then walk the SSE lines
    console.log(`[TinyFish] Waiting for SSE stream to complete...`);
    const text = await response.text();
    const lines = text.split("\n");
    let finalData: Record<string, any> | null = null;
    let rawText: string | undefined;

    // Log SSE event summary for debugging
    const eventLines = lines.filter(l => l.startsWith("data:"));
    console.log(`[TinyFish] SSE received: ${eventLines.length} data events, ${text.length} bytes total`);

    // Log unique event types seen
    const seenTypes = new Set<string>();
    for (const line of eventLines) {
      try {
        const ev = JSON.parse(line.slice(5).trim());
        const key = `${ev.type}/${ev.status ?? ""}`;
        if (!seenTypes.has(key)) {
          seenTypes.add(key);
          console.log(`[TinyFish] Event type seen: ${key}`, JSON.stringify(ev).slice(0, 200));
        }
      } catch { /* skip */ }
    }

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;

      try {
        const event = JSON.parse(dataStr);

        // Handle COMPLETE/COMPLETED
        if (event.type === "COMPLETE" && event.status === "COMPLETED") {
          console.log(`[TinyFish] COMPLETED event — resultJson type: ${typeof event.resultJson}, result type: ${typeof event.result}`);
          if (event.resultJson) {
            if (typeof event.resultJson === "string") {
              try {
                finalData = JSON.parse(event.resultJson);
              } catch {
                rawText = event.resultJson;
              }
            } else {
              finalData = event.resultJson;
            }
          } else if (event.result !== undefined && event.result !== null) {
            // result can be a pre-parsed object or a string
            if (typeof event.result === "string") {
              try {
                finalData = JSON.parse(event.result);
              } catch {
                rawText = event.result;
              }
            } else {
              // Already a parsed object — use directly
              finalData = event.result;
            }
          }
          break;
        }

        // Handle COMPLETE/FAILED
        if (event.type === "COMPLETE" && event.status === "FAILED") {
          throw new Error(`TinyFish agent failed: ${event.error || "Unknown error"}`);
        }

        // Handle alternate completion event shapes
        if (event.status === "COMPLETED" || event.status === "SUCCESS") {
          console.log(`[TinyFish] Alt completion event:`, JSON.stringify(event).slice(0, 300));
          if (event.resultJson) {
            finalData = typeof event.resultJson === "string" ? JSON.parse(event.resultJson) : event.resultJson;
          } else if (event.result) {
            rawText = String(event.result);
          } else if (event.data) {
            finalData = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          }
          break;
        }
      } catch (parseErr) {
        // Skip non-JSON SSE lines
      }
    }

    if (!finalData && !rawText) {
      console.log(`[TinyFish] No structured data extracted. Last 2 events:`, eventLines.slice(-2).join("\n").slice(0, 400));
    }

    return { success: true, data: finalData, rawText };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Search a supplier directory (ThomasNet, Alibaba, etc.) and return a list of supplier URLs.
 */
export async function searchSupplierDirectory(
  directoryUrl: string,
  query: string,
  directoryName: string
): Promise<string[]> {
  const goal = `Search for "${query}" on this supplier directory. 
Find at least 5 supplier/manufacturer company names and their profile URLs.
Return a JSON array of objects: [{"name": "Company Name", "url": "https://..."}]
Only include real companies with actual profile pages. Do not include ad links or navigation links.`;

  const result = await runAgent(directoryUrl, goal, { browserProfile: "stealth" });

  if (!result.success || !result.data) {
    console.log(`[TinyFish] ${directoryName} search failed:`, result.error);
    return [];
  }

  // Try to parse the result as an array of suppliers
  let suppliers: Array<{ name: string; url: string }> = [];
  if (Array.isArray(result.data)) {
    suppliers = result.data;
  } else if (result.data.suppliers) {
    suppliers = result.data.suppliers;
  } else if (result.data.results) {
    suppliers = result.data.results;
  }

  return suppliers.map((s: any) => s.url).filter(Boolean);
}

/**
 * Visit a supplier website and extract structured capability information.
 */
export async function extractSupplierInfo(
  supplierUrl: string,
  spec: string
): Promise<Record<string, any> | null> {
  const goal = `Visit this manufacturer/supplier website and extract their company information.
Navigate to relevant pages like "About", "Products", "Capabilities", "Certifications" if available.

Return a JSON object with exactly this structure:
{
  "supplier_name": "Company Name",
  "location": "City, Country",
  "certifications": "ISO 9001, ISO 14001, etc. or null if none found",
  "capabilities": "Brief description of what they manufacture/supply",
  "estimated_moq": 500,
  "lead_time": "4-6 weeks or null",
  "website": "${supplierUrl}",
  "confidence_score": 8
}

For confidence_score: rate 1-10 based on how much relevant info you found.
For estimated_moq: use a number (integer), null if not found.
For certifications: be specific, list actual certifications found.`;

  const result = await runAgent(supplierUrl, goal, { browserProfile: "stealth" });

  if (!result.success || !result.data) {
    console.log(`[TinyFish] Failed to extract from ${supplierUrl}:`, result.error);
    return null;
  }

  return result.data;
}

/**
 * Find and submit an RFQ/contact form on a supplier website.
 */
export async function submitRFQForm(
  supplierUrl: string,
  rfqData: {
    name: string;
    company: string;
    email: string;
    spec: string;
  }
): Promise<{ success: boolean; message: string }> {
  const goal = `Navigate this supplier website and find a contact form, RFQ form, or "Request Quote" form.
Fill in the form with these details:
- Name: ${rfqData.name}
- Company: ${rfqData.company}
- Email: ${rfqData.email}
- Message: "Hello, we are sourcing suppliers for the following product specification: ${rfqData.spec}. Could you provide pricing and MOQ details?"

Submit the form. Return JSON: {"submitted": true/false, "confirmationMessage": "text of any confirmation shown or null"}`;

  const result = await runAgent(supplierUrl, goal, { browserProfile: "stealth" });

  if (!result.success) {
    return { success: false, message: result.error || "Failed to submit RFQ" };
  }

  const submitted = result.data?.submitted || result.data?.success || false;
  const confirmation = result.data?.confirmationMessage || result.data?.confirmation || "Form submitted";

  return { success: Boolean(submitted), message: String(confirmation) };
}
