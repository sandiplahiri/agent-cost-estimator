# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-inventory.spec.ts >> inventory edits one linked group member and preserves reconciled costs
- Location: e2e/agent-inventory.spec.ts:7:1

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.click: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: 'Edit agent' }).locator('article').filter({ has: getByRole('dialog', { name: 'Edit agent' }).getByLabel('Step 2 name') }).getByText('Step execution details', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - link "AgentLedger ARCHITECT WORKSPACE" [ref=e5] [cursor=pointer]:
      - /url: "#"
      - generic [ref=e10]:
        - text: AgentLedger
        - generic [ref=e11]: ARCHITECT WORKSPACE
    - generic [ref=e12]: PLANNING
    - navigation "Main navigation" [ref=e13]:
      - button "Dashboard" [ref=e14] [cursor=pointer]:
        - text: Dashboard
        - generic [ref=e20]: "4"
      - button "Agent inventory" [ref=e21] [cursor=pointer]
      - button "Agent suite graph" [ref=e26] [cursor=pointer]
      - button "Complexity profiles" [ref=e32] [cursor=pointer]
      - button "Scenarios" [ref=e34] [cursor=pointer]
      - button "Model pricing" [ref=e39] [cursor=pointer]
      - button "Agent harness" [ref=e45] [cursor=pointer]
      - button "Additional costs" [ref=e49] [cursor=pointer]
    - button "Open estimate 2" [ref=e52] [cursor=pointer]:
      - text: Open estimate
      - generic [ref=e55]: "2"
    - button "New estimate" [ref=e56] [cursor=pointer]
    - generic [ref=e58]:
      - generic [ref=e59]: LOCAL WORKSPACE
      - paragraph [ref=e61]: Your estimates stay onthis computer.
      - generic [ref=e62]:
        - text: AI
        - generic [ref=e63]:
          - text: AI architect
          - generic [ref=e64]: Personal workspace
  - generic [ref=e65]:
    - banner [ref=e66]:
      - generic [ref=e67]:
        - text: Workspace
        - generic [ref=e70]: Agent inventory
      - generic [ref=e71]:
        - generic [ref=e72]: Browser draft
        - button "Save estimate" [ref=e74] [cursor=pointer]
        - button "Export Excel" [ref=e79] [cursor=pointer]
    - main [ref=e82]:
      - generic [ref=e83]:
        - generic [ref=e84]:
          - generic [ref=e85]:
            - text: LLM COST PLANNER
            - generic [ref=e86]: USD
          - heading "Know every agent in your suite." [level=1] [ref=e87]
          - paragraph [ref=e88]: Review and edit one agent at a time, including its use case, steps, and daily workload.
        - generic [ref=e90]:
          - generic [ref=e91]: Estimate name
          - textbox "Estimate name" [ref=e92]: Inventory journey fixture
      - region "Monthly LLM scenarios" [ref=e93]:
        - article [ref=e94]:
          - generic [ref=e95]: LOW SCENARIO
          - generic [ref=e100]: $2.14/mo
          - paragraph [ref=e101]: Input 0.75× · Output 0.75× · Volume 1×
          - paragraph [ref=e102]:
            - text: "Suite total (models + tools + harness + extras):"
            - strong [ref=e103]: $2.14
          - generic [ref=e104]:
            - generic [ref=e105]: Explicit, editable assumptions
            - button "Edit Low scenario" [ref=e106] [cursor=pointer]
        - article [ref=e109]:
          - generic [ref=e110]:
            - generic [ref=e111]: EXPECTED MONTHLY SPEND
            - generic [ref=e112]: BASELINE
          - generic [ref=e113]: $2.86/mo
          - paragraph [ref=e114]: Input 1× · Output 1× · Volume 1×
          - paragraph [ref=e115]:
            - text: "Suite total (models + tools + harness + extras):"
            - strong [ref=e116]: $2.86
          - generic [ref=e117]:
            - generic [ref=e118]: 4 agents in your suite
            - button "Edit Expected scenario" [ref=e119] [cursor=pointer]
        - article [ref=e122]:
          - generic [ref=e123]: HIGH SCENARIO
          - generic [ref=e128]: $4.28/mo
          - paragraph [ref=e129]: Input 1.5× · Output 1.5× · Volume 1×
          - paragraph [ref=e130]:
            - text: "Suite total (models + tools + harness + extras):"
            - strong [ref=e131]: $4.28
          - generic [ref=e132]:
            - generic [ref=e133]: Explicit, editable assumptions
            - button "Edit High scenario" [ref=e134] [cursor=pointer]
      - region "Agent inventory" [ref=e137]:
        - generic [ref=e138]:
          - generic [ref=e139]:
            - heading "Agents 4" [level=2] [ref=e140]:
              - text: Agents
              - generic [ref=e141]: "4"
            - paragraph [ref=e142]: Each row is one agent. Open a row to edit its use case, steps, models, and workload.
          - button "Add agent" [ref=e143] [cursor=pointer]
        - generic [ref=e145]:
          - textbox "Search agent inventory" [ref=e146]:
            - /placeholder: Search agents or use cases…
          - generic [ref=e147]: Caller and callee counts include all unique agent identities.
          - generic [ref=e148]: Expected monthly models, tools, and allocated harness. Suite extras and unallocated fixed harness stay at suite level.
        - table [ref=e150]:
          - rowgroup [ref=e151]:
            - row [ref=e152]:
              - columnheader "AGENT NAME" [ref=e153]
              - columnheader "USE CASE NAME" [ref=e154]
              - columnheader "STEPS" [ref=e155]
              - columnheader "CALLED BY AGENTS" [ref=e156]
              - columnheader "CALLS AGENTS" [ref=e157]
              - columnheader "USERS / AGENT / DAY" [ref=e158]
              - columnheader "INVOCATIONS / USER / AGENT / DAY" [ref=e159]
              - columnheader "TOTAL COST" [ref=e160]
              - columnheader "Actions" [ref=e161]
          - rowgroup [ref=e163]:
            - row [ref=e164]:
              - cell [ref=e165]:
                - strong [ref=e166]: Planner A
              - cell "Planner group" [ref=e167]
              - cell "1" [ref=e168]
              - cell "0" [ref=e169]
              - cell "1" [ref=e170]
              - cell "1" [ref=e171]
              - cell "10" [ref=e172]
              - cell "$0.84/mo" [ref=e173]
              - cell [ref=e174]:
                - button "Edit Planner A" [ref=e175] [cursor=pointer]: Edit
            - row [ref=e176]:
              - cell [ref=e177]:
                - strong [ref=e178]: Planner B
              - cell "Planner group" [ref=e179]
              - cell "1" [ref=e180]
              - cell "0" [ref=e181]
              - cell "1" [ref=e182]
              - cell "1" [ref=e183]
              - cell "10" [ref=e184]
              - cell "$0.84/mo" [ref=e185]
              - cell [ref=e186]:
                - button "Edit Planner B" [ref=e187] [cursor=pointer]: Edit
            - row [ref=e188]:
              - cell [ref=e189]:
                - strong [ref=e190]: Research
              - cell "Research" [ref=e191]
              - cell "1" [ref=e192]
              - cell "2" [ref=e193]
              - cell "1" [ref=e194]
              - cell "0" [ref=e195]
              - cell "0" [ref=e196]
              - cell "$0.84/mo" [ref=e197]
              - cell [ref=e198]:
                - button "Edit Research" [ref=e199] [cursor=pointer]: Edit
            - row [ref=e200]:
              - cell [ref=e201]:
                - strong [ref=e202]: Reviewer
              - cell "Reviewer" [ref=e203]
              - cell "1" [ref=e204]
              - cell "1" [ref=e205]
              - cell "0" [ref=e206]
              - cell "0" [ref=e207]
              - cell "0" [ref=e208]
              - cell "$0.34/mo" [ref=e209]
              - cell [ref=e210]:
                - button "Edit Reviewer" [ref=e211] [cursor=pointer]: Edit
      - region "Agent setup" [ref=e212]:
        - generic [ref=e213]:
          - generic [ref=e214]:
            - heading "Agent setup 4 agents" [level=2] [ref=e215]:
              - text: Agent setup
              - generic [ref=e216]: 4 agents
            - paragraph [ref=e217]: Set up agents and their workload. Customize each agent as needed.
          - generic [ref=e218]:
            - link "Template" [ref=e219] [cursor=pointer]:
              - /url: /api/import/template
            - button "Export JSON" [ref=e223] [cursor=pointer]
            - button "Import JSON" [ref=e224] [cursor=pointer]
            - button "Import" [ref=e225] [cursor=pointer]
            - button "Quick setup" [ref=e229] [cursor=pointer]
        - generic [ref=e231]:
          - textbox "Search agents" [ref=e232]:
            - /placeholder: Search agents…
          - generic [ref=e233]: Invocations include calls from other agents.
          - button "Add agent" [ref=e234] [cursor=pointer]
        - paragraph [ref=e236]: "* Required for directly invoked agents. Monthly invocations per agent = users per day × invocations per user per agent per day × 30 days. Linked agents receive work from callers; that work is divided evenly among agents sharing these assumptions."
        - table [ref=e238]:
          - rowgroup [ref=e239]:
            - row [ref=e240]:
              - columnheader "AGENT" [ref=e241]
              - columnheader "COUNT" [ref=e242]
              - columnheader "USERS / AGENT / DAY *" [ref=e243]
              - columnheader "INVOCATIONS / USER / AGENT / DAY *" [ref=e244]
              - columnheader "MONTHLY INVOCATIONS" [ref=e245]
              - columnheader "MODEL" [ref=e246]
              - columnheader "LLM / MONTH" [ref=e247]
              - columnheader "Actions" [ref=e248]
          - rowgroup [ref=e250]:
            - row [ref=e251]:
              - cell "Planner group simple 1 detailed steps" [ref=e252]:
                - button "Planner group" [ref=e253] [cursor=pointer]
                - generic [ref=e254]:
                  - generic [ref=e255]: simple
                  - generic [ref=e256]: 1 detailed steps
              - cell [ref=e257]:
                - spinbutton "Planner group count" [ref=e258]: "2"
              - cell [ref=e259]:
                - spinbutton "Planner group users per day" [ref=e260]: "1"
              - cell [ref=e261]:
                - spinbutton "Planner group invocations per user per agent per day" [ref=e262]: "10"
              - cell [ref=e263]:
                - generic [ref=e264]:
                  - generic [ref=e265]:
                    - text: "Per agent:"
                    - status "Planner group total monthly invocations per agent" [ref=e266]: "300"
                  - generic [ref=e267]:
                    - text: "All agents:"
                    - status "Planner group total monthly invocations all agents" [ref=e268]: "600"
              - cell [ref=e269]:
                - button "Copy Planner group" [ref=e270] [cursor=pointer]: Copy
                - button "Multiple steps" [ref=e271] [cursor=pointer]
              - cell "$1.68" [ref=e274]
              - cell [ref=e275]:
                - button "Edit Planner group" [ref=e276] [cursor=pointer]
            - row [ref=e280]:
              - cell "Research simple 1 detailed steps" [ref=e281]:
                - button "Research" [ref=e282] [cursor=pointer]
                - generic [ref=e283]:
                  - generic [ref=e284]: simple
                  - generic [ref=e285]: 1 detailed steps
              - cell [ref=e286]:
                - spinbutton "Research count" [ref=e287]: "1"
              - cell [ref=e288]:
                - spinbutton "Research users per day" [disabled] [ref=e289]
              - cell [ref=e290]:
                - spinbutton "Research invocations per user per agent per day" [disabled] [ref=e291]
              - 'cell "Per agent: Research total monthly invocations per agent All agents: Research total monthly invocations all agents Derived from agent links" [ref=e292]':
                - generic [ref=e293]:
                  - generic [ref=e294]:
                    - text: "Per agent:"
                    - status "Research total monthly invocations per agent" [ref=e295]: "300"
                  - generic [ref=e296]:
                    - text: "All agents:"
                    - status "Research total monthly invocations all agents" [ref=e297]: "300"
                  - generic [ref=e298]: Derived from agent links
              - cell [ref=e299]:
                - button "Copy Research" [ref=e300] [cursor=pointer]: Copy
                - button "Multiple steps" [ref=e301] [cursor=pointer]
              - cell "$0.84" [ref=e304]
              - cell [ref=e305]:
                - button "Edit Research" [ref=e306] [cursor=pointer]
            - row [ref=e310]:
              - cell "Reviewer simple 1 detailed steps" [ref=e311]:
                - button "Reviewer" [ref=e312] [cursor=pointer]
                - generic [ref=e313]:
                  - generic [ref=e314]: simple
                  - generic [ref=e315]: 1 detailed steps
              - cell [ref=e316]:
                - spinbutton "Reviewer count" [ref=e317]: "1"
              - cell [ref=e318]:
                - spinbutton "Reviewer users per day" [disabled] [ref=e319]
              - cell [ref=e320]:
                - spinbutton "Reviewer invocations per user per agent per day" [disabled] [ref=e321]
              - 'cell "Per agent: Reviewer total monthly invocations per agent All agents: Reviewer total monthly invocations all agents Derived from agent links" [ref=e322]':
                - generic [ref=e323]:
                  - generic [ref=e324]:
                    - text: "Per agent:"
                    - status "Reviewer total monthly invocations per agent" [ref=e325]: "120"
                  - generic [ref=e326]:
                    - text: "All agents:"
                    - status "Reviewer total monthly invocations all agents" [ref=e327]: "120"
                  - generic [ref=e328]: Derived from agent links
              - cell [ref=e329]:
                - button "Copy Reviewer" [ref=e330] [cursor=pointer]: Copy
                - button "Multiple steps" [ref=e331] [cursor=pointer]
              - cell "$0.34" [ref=e334]
              - cell [ref=e335]:
                - button "Edit Reviewer" [ref=e336] [cursor=pointer]
      - generic [ref=e341]:
        - generic [ref=e342]: Customer assumptions & notes
        - textbox "Customer assumptions & notes" [ref=e343]:
          - /placeholder: Document scope, expected usage, exclusions or assumptions to include in the workbook…
      - generic [ref=e344]:
        - generic [ref=e345]: Local planning · No paid model calls
        - generic [ref=e349]: Estimates are only as reliable as their assumptions.
  - dialog "Edit agent" [ref=e350]:
    - generic [ref=e351]:
      - heading "Edit agent" [level=2] [ref=e352]
      - button "Close dialog" [ref=e353] [cursor=pointer]
    - generic [ref=e357]:
      - generic [ref=e358]:
        - generic [ref=e359]: Agent name
        - textbox "Agent name" [ref=e360]: Planner A tuned
      - generic [ref=e361]:
        - generic [ref=e362]: Business use case name
        - textbox "Business use case name" [ref=e363]:
          - /placeholder: e.g. Resolve a billing inquiry
          - text: Plan support response
      - generic [ref=e364]:
        - generic [ref=e365]: Business use case description
        - textbox "Business use case description" [ref=e366]: Plans complex requests
      - generic [ref=e367]:
        - generic [ref=e368]: Users per agent per day *
        - spinbutton "Users per agent per day *" [ref=e369]: "2"
        - generic [ref=e370]: Daily users of this agent. Uses a 30-day planning month.
      - generic [ref=e371]:
        - generic [ref=e372]: Invocations per user per agent per day *
        - spinbutton "Invocations per user per agent per day *" [ref=e373]: "10"
        - generic [ref=e374]: Average per user for each agent, including calls from other agents.
    - paragraph [ref=e375]: "* Required for a directly invoked agent. Monthly invocations are calculated from these inputs using 30 days/month."
    - region "Agent cost" [ref=e376]:
      - heading "Cost" [level=3] [ref=e377]
      - paragraph [ref=e378]: Expected monthly · USD. Updates with your edits. Token costs exclude harness, tools, and other costs.
      - table [ref=e380]:
        - rowgroup [ref=e381]:
          - row [ref=e382]:
            - columnheader "Total input tokens" [ref=e383]
            - columnheader "Input token cost" [ref=e384]
            - columnheader "Total output tokens" [ref=e385]
            - columnheader "Output token cost" [ref=e386]
            - columnheader "Total token cost" [ref=e387]
        - rowgroup [ref=e388]:
          - row [ref=e389]:
            - cell "1,200,000" [ref=e390]
            - cell "$1.80" [ref=e391]
            - cell "120,000" [ref=e392]
            - cell "$0.72" [ref=e393]
            - cell "$2.52" [ref=e394]
    - region "Agent steps" [ref=e395]:
      - heading "Steps" [level=3] [ref=e396]
      - paragraph [ref=e397]: One invocation completes this use case. Choose the model and complexity profile for each step.
      - article [ref=e398]:
        - generic [ref=e399]:
          - strong [ref=e400]: Step 1
          - generic [ref=e401]:
            - button "Move up" [disabled] [ref=e402]
            - button "Copy step" [ref=e403] [cursor=pointer]
            - button "Remove step 1" [ref=e404] [cursor=pointer]
        - generic [ref=e408]:
          - generic [ref=e409]:
            - generic [ref=e410]: Step 1 name
            - textbox "Step 1 name" [ref=e411]: Main step
          - generic [ref=e412]:
            - generic [ref=e413]: Step 1 complexity profile
            - combobox "Step 1 complexity profile" [ref=e414]:
              - option "simple" [selected]
              - option "medium"
              - option "high"
        - generic [ref=e415]:
          - generic [ref=e416]: Step 1 model name
          - 'button "Step 1 model name: Fixture model" [ref=e417] [cursor=pointer]':
            - generic [ref=e418]: Fixture model
        - button "Add model to step" [ref=e422] [cursor=pointer]
        - region "Step 1 cost" [ref=e424]:
          - heading "Cost" [level=4] [ref=e425]
          - paragraph [ref=e426]: Expected monthly · USD. Updates with your edits. Token costs exclude harness, tools, and other costs.
          - table [ref=e428]:
            - rowgroup [ref=e429]:
              - row [ref=e430]:
                - columnheader "Total input tokens" [ref=e431]
                - columnheader "Input token cost" [ref=e432]
                - columnheader "Total output tokens" [ref=e433]
                - columnheader "Output token cost" [ref=e434]
                - columnheader "Total token cost" [ref=e435]
            - rowgroup [ref=e436]:
              - row [ref=e437]:
                - cell "600,000" [ref=e438]
                - cell "$1.20" [ref=e439]
                - cell "60,000" [ref=e440]
                - cell "$0.48" [ref=e441]
                - cell "$1.68" [ref=e442]
        - group [ref=e443]:
          - generic "Step execution details" [ref=e444] [cursor=pointer]
      - article [ref=e445]:
        - generic [ref=e446]:
          - strong [ref=e447]: Step 2
          - generic [ref=e448]:
            - button "Move up" [ref=e449] [cursor=pointer]
            - button "Copy step" [ref=e450] [cursor=pointer]
            - button "Remove step 2" [ref=e451] [cursor=pointer]
        - generic [ref=e455]:
          - generic [ref=e456]:
            - generic [ref=e457]: Step 2 name
            - textbox "Step 2 name" [ref=e458]: Review plan
          - generic [ref=e459]:
            - generic [ref=e460]: Step 2 complexity profile
            - combobox "Step 2 complexity profile" [ref=e461]:
              - option "simple"
              - option "medium" [selected]
              - option "high"
        - generic [ref=e462]:
          - generic [ref=e463]: Step 2 model name
          - 'button "Step 2 model name: Fixture review model" [ref=e464] [cursor=pointer]':
            - generic [ref=e465]: Fixture review model
        - button "Add model to step" [ref=e469] [cursor=pointer]
        - region "Step 2 cost" [ref=e471]:
          - heading "Cost" [level=4] [ref=e472]
          - paragraph [ref=e473]: Expected monthly · USD. Updates with your edits. Token costs exclude harness, tools, and other costs.
          - table [ref=e475]:
            - rowgroup [ref=e476]:
              - row [ref=e477]:
                - columnheader "Total input tokens" [ref=e478]
                - columnheader "Input token cost" [ref=e479]
                - columnheader "Total output tokens" [ref=e480]
                - columnheader "Output token cost" [ref=e481]
                - columnheader "Total token cost" [ref=e482]
            - rowgroup [ref=e483]:
              - row [ref=e484]:
                - cell "600,000" [ref=e485]
                - cell "$0.60" [ref=e486]
                - cell "60,000" [ref=e487]
                - cell "$0.24" [ref=e488]
                - cell "$0.84" [ref=e489]
        - group [ref=e490]:
          - generic "Step execution details" [ref=e491] [cursor=pointer]
      - button "Add step" [ref=e492] [cursor=pointer]
    - generic [ref=e494]:
      - heading "Tool and non-LLM costs" [level=3] [ref=e495]
      - button "Add tool cost" [ref=e496] [cursor=pointer]
    - paragraph [ref=e498]: Linked agents can be customized individually. Incoming work is divided, and outgoing calls are copied for the customized agent. Remove links before deleting linked agents.
    - button "Apply changes" [ref=e500] [cursor=pointer]
```

# Test source

```ts
  112 |   expect(baselineCost).toBeCloseTo(2.856, 9);
  113 |   await page.addInitScript((draft) => {
  114 |     if (!localStorage.getItem('agent-ledger-draft-v1'))
  115 |       localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft));
  116 |   }, estimate);
  117 |   await page.goto('/');
  118 |   await expect(page.getByTestId('cost-expected')).toContainText('$2.86');
  119 |   await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  120 |   const inventory = page.getByRole('region', { name: 'Agent inventory' });
  121 |   await expect(inventory.locator('tbody tr')).toHaveCount(4);
  122 |   await expect(inventory.getByRole('columnheader', { name: 'USE CASE NAME' })).toBeVisible();
  123 |   await expect(inventory.getByRole('columnheader', { name: 'TOTAL COST' })).toBeVisible();
  124 |   const plannerA = inventory.locator('tr').filter({ hasText: 'Planner A' });
  125 |   const plannerB = inventory.locator('tr').filter({ hasText: 'Planner B' });
  126 |   const research = inventory.locator('tr').filter({ hasText: 'Research' });
  127 |   const reviewer = inventory.locator('tr').filter({ hasText: 'Reviewer' });
  128 |   await expect(plannerA.locator('td').nth(1)).toHaveText('Planner group');
  129 |   await expect(plannerA.locator('td').nth(7)).toHaveText('$0.84/mo');
  130 |   await expect(plannerB.locator('td').nth(7)).toHaveText('$0.84/mo');
  131 |   await expect(research.locator('td').nth(7)).toHaveText('$0.84/mo');
  132 |   await expect(reviewer.locator('td').nth(7)).toHaveText('$0.34/mo');
  133 |   await expect(plannerA.locator('td').nth(2)).toHaveText('1');
  134 |   await expect(plannerA.locator('td').nth(4)).toHaveText('1');
  135 |   await expect(plannerA.locator('td').nth(5)).toHaveText('1');
  136 |   await expect(plannerA.locator('td').nth(6)).toHaveText('10');
  137 |   await expect(research.locator('td').nth(3)).toHaveText('2');
  138 |   await expect(research.locator('td').nth(4)).toHaveText('1');
  139 |   const researchCallers = Number(await research.locator('td').nth(3).innerText());
  140 | 
  141 |   await inventory.getByRole('button', { name: 'Edit Planner A' }).click();
  142 |   await page
  143 |     .getByRole('dialog', { name: 'Edit agent' })
  144 |     .getByRole('button', { name: 'Close dialog' })
  145 |     .click();
  146 |   expect(
  147 |     await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!).agents.length),
  148 |   ).toBe(3);
  149 |   await inventory.getByRole('button', { name: 'Edit Planner A' }).click();
  150 |   const editor = page.getByRole('dialog', { name: 'Edit agent' });
  151 |   await expect(editor.getByLabel('Agent name')).toHaveValue('Planner A');
  152 |   await expect(editor.getByLabel('Agent count')).toHaveCount(0);
  153 |   await expect(editor.getByLabel('Business use case name')).toBeVisible();
  154 |   await expect(editor.getByLabel('Business use case completed by one invocation')).toHaveCount(0);
  155 |   await expect(editor.getByLabel('Complexity', { exact: true })).toHaveCount(0);
  156 |   await expect(editor.getByText('Agent identities')).toHaveCount(0);
  157 |   await expect(editor.getByLabel('Agent 1 ID')).toHaveCount(0);
  158 |   await expect(editor.getByText('Execution assumptions')).toHaveCount(0);
  159 |   await expect(editor.getByRole('region', { name: 'Agent steps' })).toBeVisible();
  160 |   const agentCost = editor.getByRole('region', { name: 'Agent cost' });
  161 |   const readAgentCost = async (values: string[]) => {
  162 |     await expect(agentCost.getByRole('cell')).toHaveText(values);
  163 |     return agentCost.getByRole('cell').allTextContents();
  164 |   };
  165 |   const initialAgentCost = await readAgentCost(['300,000', '$0.60', '30,000', '$0.24', '$0.84']);
  166 |   const stepCost = (index: number) => editor.getByRole('region', { name: `Step ${index} cost`, exact: true });
  167 |   await expect(stepCost(1).getByRole('cell')).toHaveText(initialAgentCost);
  168 |   await expect(editor.getByRole('button', { name: 'Step 1 model name: Fixture model' })).toBeVisible();
  169 |   await editor.screenshot({ path: path.join(directory, 'edit-agent-panel.png') });
  170 |   await editor.getByLabel('Agent name').fill('Planner A tuned');
  171 |   await editor.getByLabel('Business use case name').fill('Plan support response');
  172 |   await editor.getByLabel('Business use case description', { exact: true }).fill('Plans complex requests');
  173 |   await editor.getByLabel('Users per agent per day *').fill('2');
  174 |   await editor.getByRole('button', { name: 'Copy step' }).click();
  175 |   await editor.getByLabel('Step 2 name').fill('Review plan');
  176 |   await editor.getByLabel('Step 2 complexity profile').selectOption('medium');
  177 |   await editor.getByRole('button', { name: 'Step 2 model name: Fixture model' }).click();
  178 |   await page
  179 |     .getByRole('dialog', { name: 'Choose a model' })
  180 |     .getByRole('button', { name: /Fixture review model/ })
  181 |     .click();
  182 |   const editedAgentCost = await readAgentCost(['1,200,000', '$1.80', '120,000', '$0.72', '$2.52']);
  183 |   const mainStepCost = ['600,000', '$1.20', '60,000', '$0.48', '$1.68'];
  184 |   const reviewStepCost = ['600,000', '$0.60', '60,000', '$0.24', '$0.84'];
  185 |   await expect(stepCost(1).getByRole('cell')).toHaveText(mainStepCost);
  186 |   await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  187 |   const editedStepCosts = [
  188 |     await stepCost(1).getByRole('cell').allTextContents(),
  189 |     await stepCost(2).getByRole('cell').allTextContents(),
  190 |   ];
  191 |   await editor.getByRole('button', { name: 'Step 2 model name: Fixture review model' }).click();
  192 |   await page
  193 |     .getByRole('dialog', { name: 'Choose a model' })
  194 |     .getByRole('button', { name: /Fixture unpriced model/ })
  195 |     .click();
  196 |   await expect(stepCost(1).getByRole('cell')).toHaveText(mainStepCost);
  197 |   await expect(stepCost(2).getByRole('cell')).toHaveText([
  198 |     '600,000',
  199 |     'Incomplete',
  200 |     '60,000',
  201 |     'Incomplete',
  202 |     'Incomplete',
  203 |   ]);
  204 |   await readAgentCost(['1,200,000', '$1.20 (partial)', '120,000', '$0.48 (partial)', '$1.68 (partial)']);
  205 |   await editor.getByRole('button', { name: 'Step 2 model name: Fixture unpriced model' }).click();
  206 |   await page
  207 |     .getByRole('dialog', { name: 'Choose a model' })
  208 |     .getByRole('button', { name: /Fixture review model/ })
  209 |     .click();
  210 |   await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  211 |   const reviewStep = editor.locator('article').filter({ has: editor.getByLabel('Step 2 name') });
> 212 |   await reviewStep.getByText('Step execution details', { exact: true }).click();
      |                                                                         ^ Error: locator.click: Test timeout of 90000ms exceeded.
  213 |   await editor.getByLabel('Step 2 execution probability (0–1)').fill('0.5');
  214 |   await expect(stepCost(2).getByRole('cell')).toHaveText(['300,000', '$0.30', '30,000', '$0.12', '$0.42']);
  215 |   await readAgentCost(['900,000', '$1.50', '90,000', '$0.60', '$2.10']);
  216 |   await editor.getByLabel('Step 2 execution probability (0–1)').fill('0');
  217 |   await expect(stepCost(2).getByRole('cell')).toHaveText(['0', '$0.00', '0', '$0.00', '$0.00']);
  218 |   await readAgentCost(mainStepCost);
  219 |   await editor.getByLabel('Step 2 execution probability (0–1)').fill('1');
  220 |   await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  221 |   await reviewStep.getByRole('button', { name: 'Move up', exact: true }).click();
  222 |   await expect(editor.getByLabel('Step 1 name')).toHaveValue('Review plan');
  223 |   await expect(stepCost(1).getByRole('cell')).toHaveText(reviewStepCost);
  224 |   await expect(stepCost(2).getByRole('cell')).toHaveText(mainStepCost);
  225 |   await editor
  226 |     .locator('article')
  227 |     .filter({ has: editor.getByLabel('Step 2 name') })
  228 |     .getByRole('button', { name: 'Move up', exact: true })
  229 |     .click();
  230 |   await expect(stepCost(1).getByRole('cell')).toHaveText(mainStepCost);
  231 |   await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  232 |   await reviewStep.screenshot({ path: path.join(directory, 'edit-step-cost.png') });
  233 |   // Previewing must not split or persist the selected member before Apply.
  234 |   const previewDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  235 |   expect(previewDraft.agents).toHaveLength(3);
  236 |   expect(previewDraft.agents[0].users_per_day).toBe('1');
  237 |   await agentCost.screenshot({ path: path.join(directory, 'edit-agent-cost.png') });
  238 |   await editor.getByRole('button', { name: 'Apply changes' }).click();
  239 |   await expect(editor).not.toBeVisible();
  240 |   await expect(page.getByTestId('cost-expected')).toContainText('$5.12');
  241 |   const tuned = inventory.locator('tr').filter({ hasText: 'Planner A tuned' });
  242 |   await expect(tuned.locator('td').nth(1)).toHaveText('Plan support response');
  243 |   await expect(tuned.locator('td').nth(7)).toHaveText('$2.52/mo');
  244 |   await expect(plannerB.locator('td').nth(7)).toHaveText('$0.84/mo');
  245 |   await expect(research.locator('td').nth(7)).toHaveText('$1.26/mo');
  246 |   await expect(reviewer.locator('td').nth(7)).toHaveText('$0.50/mo');
  247 |   await expect(tuned.locator('td').nth(2)).toHaveText('2');
  248 |   await expect(tuned.locator('td').nth(5)).toHaveText('2');
  249 |   await expect(research.locator('td').nth(3)).toHaveText('2');
  250 | 
  251 |   await inventory.getByRole('button', { name: 'Edit Research', exact: true }).click();
  252 |   const derivedAgentCost = await readAgentCost(['450,000', '$0.90', '45,000', '$0.36', '$1.26']);
  253 |   await expect(stepCost(1).getByRole('cell')).toHaveText(derivedAgentCost);
  254 |   await editor.getByRole('button', { name: 'Close dialog' }).click();
  255 | 
  256 |   await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  257 |   const monthlySummary = page.getByRole('region', { name: 'Monthly token and cost summary' });
  258 |   await expect(monthlySummary.locator('tbody tr')).toHaveCount(3);
  259 |   const scenarioSummaryExpected = [
  260 |     ['Low', ['1,597,500', '$2.745', '159,750', '$1.098', '1,757,250', '$3.843', '$0.00', '$0.00', '$3.843']],
  261 |     [
  262 |       'Expected',
  263 |       ['2,130,000', '$3.66', '213,000', '$1.464', '2,343,000', '$5.124', '$0.00', '$0.00', '$5.124'],
  264 |     ],
  265 |     ['High', ['3,195,000', '$5.49', '319,500', '$2.196', '3,514,500', '$7.686', '$0.00', '$0.00', '$7.686']],
  266 |   ] as const;
  267 |   const displayedScenarioSummaries: Record<string, string[]> = {};
  268 |   for (const [name, values] of scenarioSummaryExpected) {
  269 |     const row = monthlySummary.getByRole('row', { name, exact: true });
  270 |     await expect(row.getByRole('cell')).toHaveText([...values]);
  271 |     displayedScenarioSummaries[name] = await row.getByRole('cell').allTextContents();
  272 |   }
  273 |   await expect(monthlySummary.getByTestId('monthly-summary-expected-input-tokens')).toHaveText('2,130,000');
  274 |   await expect(monthlySummary.getByTestId('monthly-summary-expected-output-tokens')).toHaveText('213,000');
  275 |   await expect(monthlySummary.getByTestId('monthly-summary-expected-total-tokens')).toHaveText('2,343,000');
  276 |   await expect(monthlySummary.getByTestId('monthly-summary-expected-input-cost')).toHaveText('$3.66');
  277 |   await expect(monthlySummary.getByTestId('monthly-summary-expected-output-cost')).toHaveText('$1.464');
  278 |   await expect(monthlySummary.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$5.124');
  279 |   const dashboardMonthlySummaryUsd = Number(
  280 |     (await monthlySummary.getByTestId('monthly-summary-expected-total-cost').innerText()).replace(
  281 |       /[^\d.]/g,
  282 |       '',
  283 |     ),
  284 |   );
  285 |   await page.screenshot({ path: path.join(directory, 'dashboard-summary.png'), fullPage: true });
  286 | 
  287 |   await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  288 |   const saved = await (await request.get(`/api/estimates/${estimate.id}`)).json();
  289 |   await fs.writeFile(path.join(directory, 'saved.json'), JSON.stringify(saved, null, 2));
  290 |   expect(saved.agents.reduce((sum: number, agent: { count: number }) => sum + agent.count, 0)).toBe(4);
  291 |   expect(saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').steps).toHaveLength(
  292 |     2,
  293 |   );
  294 |   expect(saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').use_case_name).toBe(
  295 |     'Plan support response',
  296 |   );
  297 |   expect(
  298 |     saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').steps[1].complexity,
  299 |   ).toBe('medium');
  300 |   expect(
  301 |     saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').steps[1].model_id,
  302 |   ).toBe('Fixture review model');
  303 |   const calculated = await (await request.post('/api/calculate', { data: saved })).json();
  304 |   const editedCost = Number(
  305 |     calculated.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected').llm_cost,
  306 |   );
  307 |   const expectedScenario = calculated.scenarios.find(
  308 |     (scenario: { name: string }) => scenario.name === 'Expected',
  309 |   );
  310 |   const monthlyByAgent = Object.values(expectedScenario.agent_costs) as {
  311 |     monthly_total: string;
  312 |     complete: boolean;
```