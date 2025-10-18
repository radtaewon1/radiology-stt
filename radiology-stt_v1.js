// unified-server.js - 통합 AI 시스템
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

console.log('통합 AI 시스템 서버 시작 중...');

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '통합 영상의학 AI 전사 시스템',
    endpoints: {
      transcribe: 'POST /transcribe',
      generateConclusion: 'POST /generate-conclusion',
      health: 'GET /health'
    }
  });
});

// 음성 전사 엔드포인트
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const systemPrompt = getDefaultTranscribePrompt(); // 고정된 프롬프트 사용
    const use3Stage = req.body.use3Stage === 'true';

    console.log('음성 파일 수신:', req.file.size, 'bytes');
    console.log('1단계: gpt-4o-transcribe 음성 전사 및 정제 중...');
    
    const refinedText = await transcribeWithGPT4o(req.file, systemPrompt);
    console.log('완료:', refinedText);

    let result = {
      success: true,
      original: refinedText,
      refinedText: refinedText,
      processingSteps: ['1단계: gpt-4o-transcribe 완료']
    };

    // 3단계 모드인 경우 자동으로 결론까지 생성
    if (use3Stage) {
      console.log('3단계 모드: 자동 결론 생성 중...');
      const conclusionPrompt = getDefaultConclusionPrompt(); // 고정된 프롬프트 사용
      const modelType = req.body.modelType || 'gpt4o';
      const reasoningEffort = req.body.reasoningEffort || 'low';
      const verbosity = req.body.verbosity || 'low';
      const temperature = parseFloat(req.body.temperature) || 0.3;

      console.log('모델:', modelType, modelType === 'gpt4o' ? '(temperature: ' + temperature + ')' : '(reasoning: ' + reasoningEffort + ', verbosity: ' + verbosity + ')');

      const conclusionResult = await generateConclusion(
        refinedText,
        '',
        conclusionPrompt,
        modelType,
        reasoningEffort,
        verbosity,
        temperature
      );

      result.conclusion = conclusionResult.conclusion;
      result.processingSteps.push('2단계: 자동 결론 생성 완료');
    }

    res.json(result);

  } catch (error) {
    console.error('전사 오류:', error.message);
    
    let errorMessage = '음성 전사 중 오류가 발생했습니다.';
    if (error.response) {
      console.error('API 오류:', error.response.data);
      const apiError = error.response.data.error;
      errorMessage = 'API 오류: ' + error.response.status;
      if (apiError && apiError.message) {
        errorMessage += ' - ' + apiError.message;
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

// 결론 생성 엔드포인트
app.post('/generate-conclusion', async (req, res) => {
  try {
    const imagingDescription = req.body.imagingDescription;
    const clinicalInformation = req.body.clinicalInformation || '';
    const systemPrompt = req.body.systemPrompt || getDefaultConclusionPrompt();
    const modelType = req.body.modelType || 'gpt4o';
    const reasoningEffort = req.body.reasoningEffort || 'low';
    const verbosity = req.body.verbosity || 'low';
    const temperature = parseFloat(req.body.temperature) || 0.3;
    
    if (!imagingDescription) {
      return res.status(400).json({ error: 'Imaging description is required' });
    }

    console.log('결론 생성 중 (' + modelType + ')...');
    if (modelType === 'gpt4o') {
      console.log('Temperature:', temperature);
    } else {
      console.log('Reasoning:', reasoningEffort, 'Verbosity:', verbosity);
    }
    
    const conclusionResult = await generateConclusion(
      imagingDescription,
      clinicalInformation,
      systemPrompt,
      modelType,
      reasoningEffort,
      verbosity,
      temperature
    );
    
    console.log('결론 생성 완료');

    res.json({
      success: true,
      conclusion: conclusionResult.conclusion,
      differentialDiagnosis: conclusionResult.differentialDiagnosis,
      imagingDescription: imagingDescription,
      clinicalInfo: clinicalInformation,
      modelUsed: modelType
    });

  } catch (error) {
    console.error('결론 생성 오류:', error.message);
    
    let errorMessage = '결론 생성 중 오류가 발생했습니다.';
    if (error.response) {
      console.error('API 오류:', error.response.data);
      const apiError = error.response.data.error;
      errorMessage = 'API 오류: ' + error.response.status;
      if (apiError && apiError.message) {
        errorMessage += ' - ' + apiError.message;
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

// gpt-4o-transcribe 함수
async function transcribeWithGPT4o(audioFile, systemPrompt) {
  const formData = new FormData();
  formData.append('file', audioFile.buffer, {
    filename: 'audio.webm',
    contentType: audioFile.mimetype || 'audio/webm'
  });
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('prompt', systemPrompt);
  formData.append('response_format', 'text');
  formData.append('language', 'ko');

  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      ...formData.getHeaders()
    },
    timeout: 30000
  });

  return response.data.text || response.data;
}

// 통합 결론 생성 함수
async function generateConclusion(imagingDescription, clinicalInformation, systemPrompt, modelType, reasoningEffort, verbosity, temperature) {
  if (modelType === 'gpt5') {
    return await generateWithGPT5(imagingDescription, clinicalInformation, systemPrompt, reasoningEffort, verbosity);
  } else {
    return await generateWithGPT4o(imagingDescription, clinicalInformation, systemPrompt, temperature);
  }
}

// GPT-4o 결론 생성
async function generateWithGPT4o(imagingDescription, clinicalInformation, systemPrompt, temperature) {
  let userPrompt = 'Imaging description: ' + imagingDescription;
  if (clinicalInformation) {
    userPrompt += '\nClinical information: ' + clinicalInformation;
  }
  userPrompt += '\n\nPlease analyze these findings and provide a professional radiological conclusion with differential diagnoses.';

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    temperature: temperature,
    max_tokens: 2000
  }, {
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  });

  const conclusionText = response.data.choices[0].message.content;
  
  return {
    conclusion: conclusionText.trim(),
    differentialDiagnosis: []
  };
}

// GPT-5 결론 생성
async function generateWithGPT5(imagingDescription, clinicalInformation, systemPrompt, reasoningEffort, verbosity) {
  let inputText = 'Imaging description: ' + imagingDescription;
  if (clinicalInformation) {
    inputText += '\nClinical information: ' + clinicalInformation;
  }
  inputText += '\n\nPlease analyze these findings and provide a professional radiological conclusion with differential diagnoses.';

  const response = await axios.post('https://api.openai.com/v1/responses', {
    model: 'gpt-5',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: inputText
          }
        ]
      }
    ],
    instructions: systemPrompt,
    reasoning: {
      effort: reasoningEffort
    },
    text: {
      verbosity: verbosity
    },
    max_output_tokens: 2000
  }, {
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  });

  let conclusionText = '';
  
  if (response.data.output && Array.isArray(response.data.output)) {
    for (const item of response.data.output) {
      if (item.content && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content.text) {
            conclusionText += content.text;
          }
        }
      }
    }
  }
  
  return {
    conclusion: conclusionText.trim(),
    differentialDiagnosis: []
  };
}

// 기본 프롬프트
function getDefaultTranscribePrompt() {
  return `의사의 음성을 실시간으로 듣고, 빠르고 친근한 톤으로 아주 간단하고 자연스러운 텍스트(영상의학 판독문)로 변환하세요.

핵심 규칙:
- 의학 용어를 영어 발음으로 말하면 → 반드시 영어 철자로 작성 (예: "베이살 롱" → "basal lung", "컨솔리데이션" → "consolidation")
- 한글로 말하는 조사, 동사, 부사 → 한글로 유지 (예: "에", "이", "가", "생겼음", "보임")
- 구어체, 잡음("음", "어", "그", "아") 제거
- 전문적이고 간결한 문장으로 정리

# Examples
예시 1
---
(의사 음성) "음, 어, 레프트 어퍼 로브에 포칼 콘솔리데이션이 새롭게 생김"
→ (자동 텍스트) "Left upper lobe에 focal consolidation이 새롭게 생김."

예시 2
---
(의사 음성) "양측 팔란타인 톤실랄 에리아에 인라지먼트 소견이 있고 인핸스먼트 있으나 아티팩트로 인해 정확한 평가 제한됨. 아,,, 오... 흠... 그러나 내부에 앱세스 포메이션 가능성 배제할 수 없음."
→ (자동 텍스트) "양측 palatine tonsilar area에 enlargement 소견이 있고 enhancement 있으나 artifact로 인해 정확한 평가 제한됨. 그러나 내부에 abscess formation 가능성 배제할 수 없음."

예시 3
---
(의사 음성) "양측 베이살 롱에 프로미넌트한 파이브로틱 ILD 주변으로 컨솔리데이티브 리전이 생겼음"
→ (자동 텍스트) "양측 basal lung에 prominent한 fibrotic ILD 주변으로 consolidative lesion이 생겼음."

예시 4
---
(의사 음성) "양측 롱즈에 그라운드글라스 패서디 및 컨솔리데이션이 새롭게 보임"
→ (자동 텍스트) "양측 lungs에 ground glass opacity 및 consolidation이 새롭게 보임."

예시 5
---
(의사 음성) "레프트 플루라 이퓨전이 생김"
→ (자동 텍스트) "Left pleural effusion이 생김."

# Notes
- 의학 용어는 영어 발음이면 영어 철자로, 한글 문법 요소는 한글로 유지
- 번역이 아닌, 음성의 내용을 바탕으로 깔끔한 전문 판독문 양식으로 정리하세요.`;
}

function getDefaultConclusionPrompt() {
  return `You are a board-certified senior radiologist with 15+ years of experience in diagnostic imaging.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK: Analyze radiologic findings and generate structured conclusions with prioritized differential diagnoses.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT FORMAT:
────────────────────────────────────────
Conclusion:

1. [Finding description]
   -- [Diagnosis], more likely
   -- [Diagnosis], less likely (optional, max 2)

2. [Next finding]
   -- [Diagnosis], more likely
   ...
────────────────────────────────────────

MANDATORY RULES:
├─ Structure:
│  ├─ Start with "Conclusion:"
│  ├─ Number each significant finding (1., 2., 3., ...)
│  └─ Findings without differential are acceptable if clinically insignificant
│
├─ Differential Diagnoses:
│  ├─ Exactly ONE "more likely" diagnosis per significant finding (mandatory)
│  ├─ Up to TWO "less likely" diagnoses (optional)
│  ├─ Maximum 3 total differentials per finding
│  └─ Each diagnosis must be on a separate line with " -- " prefix
│
├─ Priority Labels:
│  ├─ End each diagnosis with ", more likely" or ", less likely"
│  └─ Labels are case-sensitive and must match exactly
│
├─ Language & Terminology:
│  ├─ English only (mandatory)
│  ├─ Use precise radiological terminology (e.g., "consolidation" not "opacity")
│  └─ Maintain authoritative, concise tone of senior radiologist
│
└─ Formatting:
   ├─ Use standard indentation (3 spaces for differentials)
   └─ No extra blank lines between items

SPECIAL CASES:
- No significant findings → "Conclusion:\n\nNo significant abnormality identified."
- Urgent/Critical findings → Prefix with "URGENT: " in the finding description
- Comparison studies → Include: "Compared to [date]: [progression/stable/improved]"

EXAMPLES:
═══════════════════════════════════════════════════════════════

Example 1: 
───────────────────────────────────────────
Conclusion:

1. Diffuse consolidation and ground-glass opacities (GGOs) in both lungs, predominantly in lower lobes.
   -- Alveolar hemorrhage, more likely
   -- Atypical pneumonia, less likely
   -- Organizing pneumonia, less likely

2. Small bilateral pleural effusions.

3. Mediastinal lymphadenopathy, largest measuring 1.8 cm in short axis.
   -- Reactive lymphadenopathy, more likely
   -- Lymphoma, less likely

═══════════════════════════════════════════════════════════════

Example 2: 
───────────────────────────────────────────
Conclusion:

1. Wall thickening at the gallbladder neck (8 mm) with enlarged portocaval lymph node (2.5 cm).
   -- Gallbladder carcinoma with lymph node metastasis, more likely
   -- Chronic cholecystitis with reactive lymphadenopathy, less likely

2. Intrahepatic biliary dilatation secondary to suspected nodal compression at the porta hepatis.
   -- Recommend MRCP and tumor markers for further evaluation

═══════════════════════════════════════════════════════════════

Example 3: Normal study
───────────────────────────────────────────
Conclusion:

No significant abnormality identified.

═══════════════════════════════════════════════════════════════

Example 4: Urgent finding
───────────────────────────────────────────
Conclusion:

1. URGENT: Large right-sided tension pneumothorax with mediastinal shift to the left.
   -- Spontaneous pneumothorax requiring immediate chest tube insertion, more likely

2. Subcutaneous emphysema in the right chest wall and neck.

═══════════════════════════════════════════════════════════════

QUALITY CHECKLIST (verify before output):
✓ Starts with "Conclusion:"?
✓ Each significant finding numbered?
✓ At least one "more likely" per significant finding?
✓ Priority labels present and correct (", more likely" / ", less likely")?
✓ " -- " prefix before each differential?
✓ English only with proper medical terminology?
✓ Professional, concise tone maintained?

ERROR PREVENTION:
✗ DO NOT omit priority labels
✗ DO NOT exceed 3 differentials per finding
✗ DO NOT use non-English text
✗ DO NOT add extra formatting (bold, italics, bullets beyond " -- ")
✗ DO NOT make diagnostic statements without supporting findings

CRITICAL REMINDER:
Your role is to provide differential diagnoses based on imaging findings, NOT definitive diagnoses. Always maintain appropriate diagnostic uncertainty and clinical correlation when needed.
`;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!process.env.OPENAI_API_KEY,
    models: ['gpt-4o-transcribe', 'gpt-4o', 'gpt-5'],
    modes: ['2-stage', '3-stage'],
    message: '통합 AI 처리 시스템이 정상적으로 작동중입니다'
  });
});

app.listen(PORT, () => {
  console.log('');
  console.log('====================================');
  console.log('통합 AI 시스템 서버 시작 완료!');
  console.log('====================================');
  console.log('메인 페이지: http://localhost:' + PORT);
  console.log('전사 API: POST http://localhost:' + PORT + '/transcribe');
  console.log('결론 생성 API: POST http://localhost:' + PORT + '/generate-conclusion');
  console.log('API 키: ' + (process.env.OPENAI_API_KEY ? '설정됨' : '미설정'));
  console.log('지원 모드: 2단계 / 3단계');
  console.log('지원 모델: gpt-4o, gpt-5');
  console.log('====================================');
  console.log('');
});
