import { Type, Static } from '@sinclair/typebox';

export const DomainStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('verifying'),
    Type.Literal('active'),
    Type.Literal('failed'),
]);
export type DomainStatus = Static<typeof DomainStatusSchema>;

export const SslStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('active'),
    Type.Literal('failed'),
]);
export type SslStatus = Static<typeof SslStatusSchema>;

export const VerificationMethodSchema = Type.Union([Type.Literal('cname'), Type.Literal('txt')]);
export type VerificationMethod = Static<typeof VerificationMethodSchema>;

export const CustomDomainSchema = Type.Object({
    _id: Type.String(),
    notebookId: Type.String(),
    domain: Type.String(),
    status: DomainStatusSchema,
    verificationMethod: VerificationMethodSchema,
    verificationToken: Type.String(),
    sslStatus: SslStatusSchema,
    createdAt: Type.String({ format: 'date-time' }),
    verifiedAt: Type.Optional(Type.String({ format: 'date-time' })),
    userId: Type.String(),
});
export type CustomDomain = Static<typeof CustomDomainSchema>;

export const CreateCustomDomainSchema = Type.Object({
    domain: Type.String({ minLength: 1, maxLength: 253 }),
});
export type CreateCustomDomainInput = Static<typeof CreateCustomDomainSchema>;
