import { randomUUID } from 'crypto';

// Mock ImageStore
const imageStore = {
    store: (data: string, mimeType: string) => {
        console.log(`[MockStore] Storing image of type ${mimeType}, length: ${data.length}`);
        return 'mock-image-uuid';
    }
};

// Mock Environment
process.env.API_BASE_URL = 'http://localhost:3000';

// User provided example input
const inputResult = {
    "content": [
        {
            "type": "text",
            "text": "**Unicity T-Shirt** (tshirt-unicity)\nPremium cotton t-shirt with Unicity branding\nPrice: 25 UCT\nSizes: S, M, L, XL, XXL\nIn Stock: Yes\n"
        },
        {
            "type": "image",
            "data": "/9j/4AAQSkZJRgABAQAAA...",
            "mimeType": "image/jpeg"
        },
        {
            "type": "text",
            "text": "\nUse place_order to purchase."
        }
    ]
};

// The logic from manager.ts
function processContent(content: any[]) {
    return content.map((item: any) => {
        if (item.type === 'image' && item.data) {
            console.log(`[Logic] Intercepting image`);
            const imageId = imageStore.store(item.data, item.mimeType);
            const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
            const imageUrl = `${baseUrl}/api/images/${imageId}`;

            console.log(`[Logic] Replaced with URL: ${imageUrl}`);

            return {
                type: 'text',
                text: `![Image](${imageUrl})`
            };
        }
        return item;
    });
}

console.log('--- Input ---');
console.log(JSON.stringify(inputResult, null, 2));

console.log('\n--- Processing ---');
const output = processContent(inputResult.content);

console.log('\n--- Output ---');
console.log(JSON.stringify(output, null, 2));
