export interface SourceEvidence {
  id:string;connector:string;sender?:string;subject?:string;occurredAt?:number|string;
  content:string;truncated:boolean;available:boolean;
}
