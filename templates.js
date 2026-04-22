/* ============================================================
   ViperEdit — Template catalog
   Each template:
     { id, name, desc, icon, accent?, html, preset? }
   `preset` is a partial Settings snapshot that will be applied
   when a document is created from the template.
   ============================================================ */

window.VE_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank document',
    desc: 'Start from a clean page',
    icon: '◦',
    accent: '#a78bfa',
    html: ''
  },

  {
    id: 'letter',
    name: 'Letter',
    desc: 'Formal correspondence',
    icon: '✉',
    accent: '#60a5fa',
    html:
`<p style="text-align:right"><i>[Your Name]<br>[Your Address]<br>[City, ST ZIP]</i></p>
<p>[Date]</p>
<p>Dear [Recipient],</p>
<p>Begin your letter here. Explain the reason you are writing in the first paragraph.</p>
<p>Use the body to elaborate on your points. Keep the tone courteous and the language clear.</p>
<p>Sincerely,</p>
<p><br><br>[Your Name]</p>`,
    preset: { fontFamily: '"EB Garamond", serif', fontSize: 12, lineHeight: 1.55, pageStyle: 'paper', pageMargins: 'normal' }
  },

  {
    id: 'resume',
    name: 'Resume',
    desc: 'Single-page CV',
    icon: '◪',
    accent: '#34d399',
    html:
`<h1 style="text-align:center;margin-bottom:4px">[Your Name]</h1>
<p style="text-align:center;color:#666">email@example.com · (555) 555-5555 · City, ST · linkedin.com/in/you</p>
<hr>
<h2>Experience</h2>
<h3>Job Title <span style="float:right;font-weight:400;color:#666">Company · 2022 – Present</span></h3>
<ul>
  <li>Delivered measurable impact — quantify whenever possible.</li>
  <li>Led initiative that produced X outcome.</li>
  <li>Built / designed / shipped Y.</li>
</ul>
<h3>Previous Title <span style="float:right;font-weight:400;color:#666">Earlier Company · 2019 – 2022</span></h3>
<ul>
  <li>Achievement with a concrete result.</li>
</ul>
<h2>Education</h2>
<h3>Degree, Major <span style="float:right;font-weight:400;color:#666">University · 2015 – 2019</span></h3>
<h2>Skills</h2>
<p>Skill A · Skill B · Skill C · Skill D · Skill E</p>`,
    preset: { fontFamily: '"Inter", sans-serif', fontSize: 11, pageStyle: 'paper', pageMargins: 'narrow' }
  },

  {
    id: 'meeting',
    name: 'Meeting notes',
    desc: 'Agenda + action items',
    icon: '◉',
    accent: '#f472b6',
    html:
`<h1>Meeting: [Topic]</h1>
<p><b>Date:</b> [Date] &nbsp; · &nbsp; <b>Attendees:</b> [Names]</p>
<h2>Agenda</h2>
<ol><li>Topic one</li><li>Topic two</li><li>Topic three</li></ol>
<h2>Discussion</h2>
<p>Notes from the conversation go here.</p>
<h2>Decisions</h2>
<ul><li>Decision made, with the reasoning.</li></ul>
<h2>Action items</h2>
<ul data-type="checklist">
  <li>Task · @owner · due [date]</li>
  <li>Follow-up · @owner · due [date]</li>
</ul>`,
    preset: {}
  },

  {
    id: 'blog',
    name: 'Blog post',
    desc: 'Article with sections',
    icon: '✎',
    accent: '#fb923c',
    html:
`<h1>Post Title</h1>
<p><i>An optional subtitle or hook.</i></p>
<p>Start with a paragraph that pulls the reader in. Don't bury the lede — make the point early and earn the rest with evidence.</p>
<h2>First section</h2>
<p>Write naturally. If you can say it in fewer words, do.</p>
<h2>Second section</h2>
<p>Use examples, quotes, or data to support your points.</p>
<blockquote>An effective quote is short, surprising, and load-bearing.</blockquote>
<h2>Conclusion</h2>
<p>Close the loop. What should the reader take away?</p>`,
    preset: { fontFamily: '"Merriweather", serif', fontSize: 12, lineHeight: 1.75 }
  },

  {
    id: 'novel',
    name: 'Novel chapter',
    desc: 'Double-spaced manuscript',
    icon: '❧',
    accent: '#c084fc',
    html:
`<h1 style="text-align:center;margin-top:80px">Chapter 1</h1>
<h3 style="text-align:center;font-weight:400;font-style:italic;color:#666">The Beginning</h3>
<p>The opening sentence of your story — the single line that makes the reader stay.</p>
<p>Let your first scene establish the character, the world, and the tension all at once. Trust the reader to keep up.</p>
<p>*  *  *</p>
<p>New scene. Same chapter. The break above gives the reader a breath.</p>`,
    preset: { fontFamily: '"Lora", serif', fontSize: 12, lineHeight: 2, pageStyle: 'paper', pageMargins: 'wide' }
  },

  {
    id: 'journal',
    name: 'Journal entry',
    desc: 'Daily writing',
    icon: '✑',
    accent: '#fbbf24',
    html:
`<h2>[Date]</h2>
<p><i>How I'm feeling right now:</i></p>
<p>Write without editing. Today…</p>
<h3>Three good things</h3>
<ol><li>…</li><li>…</li><li>…</li></ol>
<h3>One thing tomorrow will be about</h3>
<p>…</p>`,
    preset: { fontFamily: '"Caveat", cursive', fontSize: 16, lineHeight: 1.55, pageStyle: 'sepia' }
  },

  {
    id: 'brief',
    name: 'Project brief',
    desc: 'Goals, plan, timeline',
    icon: '◊',
    accent: '#22d3ee',
    html:
`<h1>Project Name</h1>
<p><b>Owner:</b> [Name] &nbsp;·&nbsp; <b>Status:</b> Draft &nbsp;·&nbsp; <b>Last updated:</b> [Date]</p>
<h2>TL;DR</h2>
<p>One paragraph: what we're building, who it's for, why now.</p>
<h2>Goals</h2>
<ul><li>Goal 1</li><li>Goal 2</li></ul>
<h2>Non-goals</h2>
<ul><li>What we explicitly are <i>not</i> doing.</li></ul>
<h2>Approach</h2>
<p>The shape of the solution. Trade-offs considered and the one picked.</p>
<h2>Timeline</h2>
<table>
  <thead><tr><th>Phase</th><th>Deliverable</th><th>Target date</th></tr></thead>
  <tbody>
    <tr><td>Discover</td><td>Research + spec</td><td>[date]</td></tr>
    <tr><td>Build</td><td>v1 shippable</td><td>[date]</td></tr>
    <tr><td>Launch</td><td>GA release</td><td>[date]</td></tr>
  </tbody>
</table>
<h2>Risks</h2>
<ul><li>Risk · mitigation</li></ul>`,
    preset: { fontFamily: '"Inter", sans-serif', fontSize: 11 }
  },

  {
    id: 'readme',
    name: 'README',
    desc: 'Project documentation',
    icon: '⟨⟩',
    accent: '#a3e635',
    html:
`<h1>project-name</h1>
<p>One-line description of what this project does.</p>
<h2>Install</h2>
<pre>npm install project-name</pre>
<h2>Usage</h2>
<pre>import { doThing } from 'project-name';

doThing({ option: true });</pre>
<h2>API</h2>
<h3><code>doThing(options)</code></h3>
<p>Describe arguments, return value, and side effects.</p>
<h2>Development</h2>
<pre>npm run dev
npm test</pre>
<h2>License</h2>
<p>MIT</p>`,
    preset: { fontFamily: '"Inter", sans-serif', fontSize: 11, pageStyle: 'paper' }
  },

  {
    id: 'recipe',
    name: 'Recipe',
    desc: 'Ingredients & steps',
    icon: '◯',
    accent: '#f87171',
    html:
`<h1>Recipe Name</h1>
<p><i>Serves 4 · Prep 10 min · Cook 20 min</i></p>
<h2>Ingredients</h2>
<ul>
  <li>1 cup flour</li>
  <li>2 tbsp olive oil</li>
  <li>1 tsp salt</li>
  <li>…</li>
</ul>
<h2>Instructions</h2>
<ol>
  <li>Preheat oven to 375°F.</li>
  <li>Combine dry ingredients in a bowl.</li>
  <li>Add wet ingredients and mix until smooth.</li>
  <li>Bake for 20 minutes.</li>
</ol>
<h2>Notes</h2>
<p>Substitutions, variations, and tips.</p>`,
    preset: { fontFamily: '"Lora", serif', fontSize: 12 }
  },

  {
    id: 'outline',
    name: 'Outline',
    desc: 'Nested bullet plan',
    icon: '≡',
    accent: '#94a3b8',
    html:
`<h1>Outline</h1>
<ul>
  <li>Main point 1
    <ul>
      <li>Supporting detail</li>
      <li>Supporting detail</li>
    </ul>
  </li>
  <li>Main point 2
    <ul>
      <li>Supporting detail</li>
    </ul>
  </li>
  <li>Main point 3</li>
</ul>`,
    preset: {}
  },

  {
    id: 'poem',
    name: 'Poem',
    desc: 'Centered verse',
    icon: '✾',
    accent: '#f9a8d4',
    html:
`<h1 style="text-align:center">Title</h1>
<p style="text-align:center;font-style:italic;color:#666">by [Author]</p>
<p style="text-align:center">First line of the verse,<br>second line flows below,<br>the third rounds it off.</p>
<p style="text-align:center">— a break between stanzas —</p>
<p style="text-align:center">And then it begins again,<br>with another idea entirely.</p>`,
    preset: { fontFamily: '"Playfair Display", serif', fontSize: 14, lineHeight: 1.75 }
  }
];
