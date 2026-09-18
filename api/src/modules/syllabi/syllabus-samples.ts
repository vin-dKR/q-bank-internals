/**
 * The two upload formats, as a file an operator can download, edit and upload back. Kept next to the parser
 * that reads them, so a change to one is a change to the other.
 */

/** A JSON sample: one exam, trimmed to two chapters so the shape is obvious at a glance. */
export const SAMPLE_JSON = `{
  "exam": "NEET",
  "title": "NEET 2026 — Biology",
  "aliases": ["NEET UG", "NEET-UG"],
  "subjects": [
    {
      "subject": "Biology",
      "aliases": ["Bio"],
      "chapters": [
        {
          "chapter": "Animal Kingdom",
          "class": 11,
          "aliases": ["Animal Kingdom (Allen)"],
          "topics": [
            "Basis of classification — levels of organisation, symmetry, coelom",
            "Classification of non-chordates up to phylum level",
            "Classification of chordates up to class level"
          ]
        },
        {
          "chapter": "Anatomy of Flowering Plants",
          "class": 11,
          "aliases": [],
          "topics": [
            "Tissues and tissue systems in plants",
            "Anatomy and functions of root, stem and leaf",
            "Secondary growth"
          ]
        }
      ]
    }
  ]
}
`;

/**
 * A CSV sample: one row per topic, with exam/subject/chapter repeated. Aliases are pipe-separated because
 * commas already separate columns, and quoted cells carry the commas inside topic names.
 */
export const SAMPLE_CSV = `exam,subject,chapter,topic,title,class,exam_aliases,subject_aliases,chapter_aliases
NEET,Biology,Animal Kingdom,"Basis of classification — levels of organisation, symmetry, coelom",NEET 2026 — Biology,11,NEET UG|NEET-UG,Bio,Animal Kingdom (Allen)
NEET,Biology,Animal Kingdom,Classification of non-chordates up to phylum level,,11,,,
NEET,Biology,Animal Kingdom,Classification of chordates up to class level,,11,,,
NEET,Biology,Anatomy of Flowering Plants,Tissues and tissue systems in plants,,11,,,
NEET,Biology,Anatomy of Flowering Plants,"Anatomy and functions of root, stem and leaf",,11,,,
NEET,Biology,Anatomy of Flowering Plants,Secondary growth,,11,,,
`;
