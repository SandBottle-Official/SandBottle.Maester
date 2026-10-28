import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { adapt, readAdaptations } from './adaptations.ts';
import { Db } from './db.ts';
import { reject } from './errors.ts';
import { claimNextEvent, markEventDone, readEvents, requeueProcessing, submitEvent } from './events.ts';
import { currentFeature, featureById, listFeatures, redBy, setRedBy, startFeature, switchFeature } from './features.ts';
import { importFeature } from './import-feature.ts';
import { dbPath, hasLegacyJson } from './paths.ts';
import { addDoc, answer, ask, readDecisions, readDocs, setStage } from './roundtable.ts';
import { migrateSchema, SCHEMA } from './schema.ts';
import { completeStep, readPlan, recordPhase, startTdd, writePlan } from './tdd.ts';
import type { AdaptationInput, AnswerInput, CompleteInput, DecisionInput, DocInput, EventInput, EventRow, ImportFeatureInput, PhaseInput, PlanInput, ShaInfo, StageInput, StartFeatureInput } from './types.ts';

export class Store extends Db {
  close() { this.connection.close(); }

  startFeature(input?: StartFeatureInput) { return startFeature(this, input); }
  switchFeature(id: string) { return switchFeature(this, id); }
  feature(id: number) { return featureById(this, id); }
  current() { return currentFeature(this); }
  features() { return listFeatures(this); }
  redBy() { return redBy(this); }
  setRedBy(value: unknown) { return setRedBy(this, value); }

  addDoc(doc?: DocInput) { return addDoc(this, doc); }
  setStage(input?: StageInput) { return setStage(this, input); }
  ask(decision?: DecisionInput) { return ask(this, decision); }
  answer(input?: AnswerInput) { return answer(this, input); }
  docs(featureId: number) { return readDocs(this, featureId); }
  decisions(featureId: number) { return readDecisions(this, featureId); }

  startTdd() { return startTdd(this); }
  writePlan(input?: PlanInput) { return writePlan(this, input); }
  phase(input?: PhaseInput) { return recordPhase(this, input); }
  complete(input: CompleteInput, commit: ShaInfo) { return completeStep(this, input, commit); }
  plan(featureId: number) { return readPlan(this, featureId); }

  adapt(input?: AdaptationInput) { return adapt(this, input); }
  adaptations() { return readAdaptations(this); }

  submit(event?: EventInput) { return submitEvent(this, event); }
  claim() { return claimNextEvent(this); }
  requeueProcessing() { return requeueProcessing(this); }
  done(id: string) { return markEventDone(this, id); }
  events(featureId: number, status: EventRow['status']) { return readEvents(this, featureId, status); }

  importFeature(data: ImportFeatureInput) { return importFeature(this, data); }
}

type OpenOptions = { write?: boolean; file?: string };

export function openStore(repo: string, { write = false, file = dbPath(repo) }: OpenOptions = {}): Store | null {
  const exists = fs.existsSync(file);
  if (!exists && !write) return null;
  if (!exists && file === dbPath(repo) && hasLegacyJson(repo)) reject('這個 repo 有舊的 json 紀錄，先執行 maester migrate');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const connection = new DatabaseSync(file);
  connection.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = Number((connection.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (version > SCHEMA) {
    connection.close();
    reject(`maester.db 的版本 ${version} 比這版 Maester（${SCHEMA}）新，請更新 Maester`);
  }
  migrateSchema(connection, version);
  return new Store(connection);
}
