/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { extractText, getDocumentProxy } from "unpdf";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Get the pathname from the request
		const pathname = new URL(request.url).pathname;

		if (pathname === "/api/upload" && request.method === "POST") {
		  // Get the file from the request
		  const formData = await request.formData();
		  const file = formData.get("pdfFile") as File;

		  // Upload the file to Cloudflare R2
		  const upload = await env.MY_BUCKET.put(file.name, file);
		  return new Response("File uploaded successfully", { status: 200 });
		}

		return new Response("incorrect route", { status: 404 });
	  },
	async queue(batch, env) {
		for (let message of batch.messages) {
			console.log(`Processing the file: ${message.body.object.key}`);

			const file = await env.MY_BUCKET.get(message.body.object.key);
			if (!file) {
				console.error(`File not found: ${message.body.object.key}`);
				continue;
			}
			// Extract the textual content from the PDF
			const buffer = await file.arrayBuffer();
			const document = await getDocumentProxy(new Uint8Array(buffer));

			const {text} = await extractText(document, {mergePages: true});
			console.log(`Extracted text: ${text.substring(0, 100)}...`);

			const result: AiSummarizationOutput = await env.AI.run(
				"@cf/facebook/bart-large-cnn",
				  {
					input_text: text,
				  }
				);
			const summary = result.summary;
			console.log(`Summary: ${summary.substring(0, 100)}...`);

			const upload = await env.MY_BUCKET.put(`${message.body.object.key}-summary.txt`, summary, {
				httpMetadata: {
				  contentType: 'text/plain',
				},
			});
			console.log(`Summary added to the R2 bucket: ${upload.key}`);
		}
	},
} satisfies ExportedHandler<Env>;
