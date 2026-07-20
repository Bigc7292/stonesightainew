import axios from 'axios';

const MOCK_CONFIG = {
  base64Image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  cosmosEndpoint: process.env.COSMOS_INFERENCE_URL || 'http://localhost:8000/v1/infer',
  prompt: 'Cinematic 11-second architectural interior video. Smooth camera movement around a modern kitchen.',
  negativePrompt: 'blurry, low quality, artifacts, distorted, unrealistic movement',
};

async function runPipelineTest() {
  console.log('=== STARTING STONE SIGHT AI: COSMOS3 GENERATOR INTEGRATION TEST ===');
  console.log(`Target Endpoint: ${MOCK_CONFIG.cosmosEndpoint}`);
  
  const payload = {
    model: 'nvidia/cosmos3-generator',
    prompt: MOCK_CONFIG.prompt,
    image: MOCK_CONFIG.base64Image,
    negative_prompt: MOCK_CONFIG.negativePrompt,
    seed: 42,
    guidance_scale: 6.0,
    num_inference_steps: 28,
  };
  
  try {
    const response = await axios.post(MOCK_CONFIG.cosmosEndpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log(`Status Code Received: ${response.status}`);
    
    if (response.data && (response.data.outputs?.[0] || response.data.b64_video || response.data.artifacts)) {
      console.log('✓ SUCCESS! Video generation response contains valid video data artifacts.');
    } else {
      console.log('⚠ WARNING: Connection succeeded but response format was unexpected.');
      console.log('Response Snapshot:', JSON.stringify(response.data).substring(0, 200));
    }

  } catch (error: any) {
    console.error('\n❌ Pipeline execution failed during endpoint round-trip.');
    if (error.response) {
      console.error(`Server rejected request with status: ${error.response.status}`);
      console.error('Context:', JSON.stringify(error.response.data));
    } else {
      console.error('Connection Error:', error.message);
    }
  }
  console.log('\n=== TEST EXECUTION SEQUENCE FINALIZED ===');
}

runPipelineTest();
