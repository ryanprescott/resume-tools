import { z } from 'zod';

// Resumes routinely carry fields that are structurally present but empty — an
// imported PDF with no location line, a hand-edited `location: ''`. Treating the
// empty string as absent keeps renderers from emitting orphaned separators.
const OptionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().optional(),
);

export const BulletSchema = z.object({
  id: z.string(),
  text: z.string(),
});

export const EntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  org: z.string(),
  start: z.string(),
  end: z.string(),
  location: OptionalText,
  bullets: z.array(BulletSchema),
});

export const SectionSchema = z
  .object({
    name: z.string(),
    entries: z.array(EntrySchema).optional(),
    bullets: z.array(BulletSchema).optional(),
  })
  .superRefine((section, ctx) => {
    const hasEntries = section.entries !== undefined;
    const hasBullets = section.bullets !== undefined;
    if (hasEntries === hasBullets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `section "${section.name}" must have exactly one of "entries" or "bullets"`,
      });
    }
  });

export const ContactSchema = z.object({
  name: z.string(),
  // The professional title printed beside/below the name ("Full Stack Developer").
  headline: OptionalText,
  email: OptionalText,
  phone: OptionalText,
  location: OptionalText,
  // Label → URL. Non-URL contact channels belong in their own fields, not here.
  links: z.record(z.string()).optional(),
});

export const MetaSchema = z
  .object({
    basedOn: z.string().optional(),
    // Set on an occupation base (`resumes/bases/`): the kind of job it is the
    // starting point for, which is what a new job description is matched on.
    occupation: OptionalText,
    // Set on a tailored variant. A posting does not always name the company or
    // a recruiter, so only the title is guaranteed.
    job: z
      .object({
        company: OptionalText,
        title: z.string(),
        recruiter: OptionalText,
      })
      .optional(),
  })
  .optional();

export const ResumeSchema = z.object({
  contact: ContactSchema,
  meta: MetaSchema,
  // Name of the layout template: `templates/<name>.html.eta`.
  template: OptionalText,
  sections: z.array(SectionSchema),
});

export type Bullet = z.infer<typeof BulletSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type Resume = z.infer<typeof ResumeSchema>;
