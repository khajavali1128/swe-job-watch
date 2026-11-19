import { AppleAdapter } from "./apple/adapter.js";
import { AtlassianAdapter } from "./atlassian/adapter.js";
import { AshbyAdapter } from "./ashby/adapter.js";
import { AvatureAdapter } from "./avature/adapter.js";
import { ByteDanceAdapter } from "./bytedance/adapter.js";
import { CiscoAdapter } from "./cisco/adapter.js";
import { EightfoldAdapter } from "./eightfold/adapter.js";
import { GreenhouseAdapter } from "./greenhouse/adapter.js";
import { IcimsAdapter } from "./icims/adapter.js";
import { LeverAdapter } from "./lever/adapter.js";
import { OracleAdapter } from "./oracle/adapter.js";
import { SmartRecruitersAdapter } from "./smartrecruiters/adapter.js";
import { SuccessFactorsAdapter } from "./successfactors/adapter.js";
import { WorkdayAdapter } from "./workday/adapter.js";
import type { CompanyConfig } from "../config/index.js";
import type { JobAdapter } from "./types.js";

type AdapterName = CompanyConfig["adapter"];
type AdapterFactory = () => JobAdapter;

const adapterFactories: Record<AdapterName, AdapterFactory> = {
  apple: () => new AppleAdapter(),
  atlassian: () => new AtlassianAdapter(),
  ashby: () => new AshbyAdapter(),
  avature: () => new AvatureAdapter(),
  bytedance: () => new ByteDanceAdapter(),
  cisco: () => new CiscoAdapter(),
  eightfold: () => new EightfoldAdapter(),
  greenhouse: () => new GreenhouseAdapter(),
  icims: () => new IcimsAdapter(),
  lever: () => new LeverAdapter(),
  oracle: () => new OracleAdapter(),
  smartrecruiters: () => new SmartRecruitersAdapter(),
  successfactors: () => new SuccessFactorsAdapter(),
  workday: () => new WorkdayAdapter(),
};

export const adapterNames = Object.freeze(
  Object.keys(adapterFactories) as AdapterName[],
);

export function createAdapter(company: CompanyConfig): JobAdapter {
  return adapterFactories[company.adapter]();
}

export function isAdapterName(value: string): value is AdapterName {
  return Object.hasOwn(adapterFactories, value);
}
