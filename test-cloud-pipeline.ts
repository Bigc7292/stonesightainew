import axios from 'axios';
import * as dotenv from 'dotenv';

// Load environment variables from the root .env file
dotenv.config();

// Define the local backend server port
const BACKEND_PORT = 3000; 
const TEST_ENDPOINT = `http://localhost:${BACKEND_PORT}/api/video/generate`;

async function runCloudPipelineTest() {
  console.log('=== STARTING STONE SIGHT AI: COSMOS 3 CLOUD INTEGRATION TEST ===');
  console.log(`Targeting Express Route: ${TEST_ENDPOINT}\n`);

  // Sample prompt mirroring a luxury stone fitting showcase
  const testPayload = {
    prompt: 'A cinematic, slow-motion panning shot of a premium polished Calacatta marble countertop installed in a modern luxury kitchen, high-end lighting reflections.',
    negativePrompt: 'blurry, low quality, shaky camera, low resolution',
    duration: 5,
    seed: 42
  };

  try {
    console.log('🔄 Sending test payload to your local Express server...');
    console.log(`Prompt: "${testPayload.prompt}"\n`);

    const response = await axios.post(TEST_ENDPOINT, testPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60-second timeout to allow the cloud cluster to respond
    });

    console.log('✅ Pipeline round-trip executed successfully!');
    console.log('--------------------------------------------------');
    console.log('📦 Server Response Status:', response.status);
    console.log('📦 Server Response Data:', JSON.stringify(response.data, null, 2));
    console.log('--------------------------------------------------\n');

    if (response.data.success && response.data.data.videoUrl) {
      console.log('🎉 SUCCESS! The cloud engine returned a video asset.');
      console.log(`🔗 Video Resource Link: ${response.data.data.videoUrl}`);
    } else {
      console.log('⚠️ Server responded, but the video URL asset structure was missing.');
    }

  } catch (error: any) {
    console.log('\n❌ Pipeline execution failed during backend round-trip.');
    
    if (error.response) {
      console.log(`Status Code: ${error.response.status}`);
      console.log('Error Details:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log('Error Message: No response received from your Express server.');
      console.log(`Ensure your local server is actively running on port ${BACKEND_PORT}.`);
    } else {
      console.log('Error Message:', error.message);
    }
  }

  console.log('\n=== TEST EXECUTION SEQUENCE FINALIZED ===');
}

runCloudPipelineTest();