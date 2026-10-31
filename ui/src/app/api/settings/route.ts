import { NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { defaultTrainFolder, defaultDatasetsFolder, defaultModelsFolder } from '@/paths';
import { flushCache, getTextEncodersFolder } from '@/server/settings';

export async function GET() {
  try {
    const settings = await prisma.settings.findMany();
    const settingsObject = settings.reduce((acc: any, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
    // if TRAINING_FOLDER is not set, use default
    if (!settingsObject.TRAINING_FOLDER || settingsObject.TRAINING_FOLDER === '') {
      settingsObject.TRAINING_FOLDER = defaultTrainFolder;
    }
    // if DATASETS_FOLDER is not set, use default
    if (!settingsObject.DATASETS_FOLDER || settingsObject.DATASETS_FOLDER === '') {
      settingsObject.DATASETS_FOLDER = defaultDatasetsFolder;
    }
    // MODELS_PATH from the env file always takes precedence over the setting
    if (process.env.MODELS_PATH && process.env.MODELS_PATH.trim() !== '') {
      settingsObject.MODELS_PATH = process.env.MODELS_PATH;
    } else if (!settingsObject.MODELS_PATH || settingsObject.MODELS_PATH === '') {
      // if MODELS_PATH is not set, use default
      settingsObject.MODELS_PATH = defaultModelsFolder;
    }
    // dual build: custom text encoders folder (blank -> <models>/text_encoders)
    if (!settingsObject.TEXT_ENCODERS_FOLDER || settingsObject.TEXT_ENCODERS_FOLDER === '') {
      settingsObject.TEXT_ENCODERS_FOLDER = await getTextEncodersFolder();
    }
    return NextResponse.json(settingsObject);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      HF_TOKEN,
      TRAINING_FOLDER,
      DATASETS_FOLDER,
      MODELS_PATH,
      TEXT_ENCODERS_FOLDER,
      DEFAULT_MODEL_ARCH,
      COMFY_URL,
      COMFY_SAMPLE_WORKFLOW,
    } = body;

    // Upsert both settings
    await Promise.all([
      prisma.settings.upsert({
        where: { key: 'HF_TOKEN' },
        update: { value: HF_TOKEN },
        create: { key: 'HF_TOKEN', value: HF_TOKEN },
      }),
      prisma.settings.upsert({
        where: { key: 'TRAINING_FOLDER' },
        update: { value: TRAINING_FOLDER },
        create: { key: 'TRAINING_FOLDER', value: TRAINING_FOLDER },
      }),
      prisma.settings.upsert({
        where: { key: 'DATASETS_FOLDER' },
        update: { value: DATASETS_FOLDER },
        create: { key: 'DATASETS_FOLDER', value: DATASETS_FOLDER },
      }),
      prisma.settings.upsert({
        where: { key: 'MODELS_PATH' },
        update: { value: MODELS_PATH },
        create: { key: 'MODELS_PATH', value: MODELS_PATH },
      }),
      prisma.settings.upsert({
        where: { key: 'TEXT_ENCODERS_FOLDER' },
        update: { value: TEXT_ENCODERS_FOLDER ?? '' },
        create: { key: 'TEXT_ENCODERS_FOLDER', value: TEXT_ENCODERS_FOLDER ?? '' },
      }),
      prisma.settings.upsert({
        where: { key: 'DEFAULT_MODEL_ARCH' },
        update: { value: DEFAULT_MODEL_ARCH ?? '' },
        create: { key: 'DEFAULT_MODEL_ARCH', value: DEFAULT_MODEL_ARCH ?? '' },
      }),
      // dual build: ComfyUI the Compare page samples through (blank = http://127.0.0.1:8188)
      prisma.settings.upsert({
        where: { key: 'COMFY_URL' },
        update: { value: COMFY_URL ?? '' },
        create: { key: 'COMFY_URL', value: COMFY_URL ?? '' },
      }),
      // dual build: workflow training samples use when a job has "Sample with ComfyUI" on
      prisma.settings.upsert({
        where: { key: 'COMFY_SAMPLE_WORKFLOW' },
        update: { value: COMFY_SAMPLE_WORKFLOW ?? '' },
        create: { key: 'COMFY_SAMPLE_WORKFLOW', value: COMFY_SAMPLE_WORKFLOW ?? '' },
      }),
    ]);

    flushCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
