import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";
import { Form } from "@/components/ui/form";
import type { CodexCatalogModel } from "@/types";

// 与 CodexFormFields.test.tsx 一致：组件内部用到 useModelMetadataFill（依赖
// QueryClientProvider），本文件只测模型覆盖开关，mock 成 no-op。
vi.mock("@/hooks/useModelMetadataFill", () => ({
  useModelMetadataFill: () => () => {},
}));

type CodexFormFieldsProps = ComponentProps<typeof CodexFormFields>;

const FormShell = ({ children }: PropsWithChildren) => {
  const form = useForm();
  return <Form {...form}>{children}</Form>;
};

// 测试环境的 i18n resources 为空，带 defaultValue 的 t() 直接返回 defaultValue。
const SWITCH_NAME = "将实际请求模型写入 model 覆盖";
const EMPTY_HINT = "请先在上方模型列表填写第一行的实际请求模型。";
const ROW_MODEL_PLACEHOLDER = "例如: deepseek-v4-flash";
const BODY_OUTPUT_TESTID = "body-override";

const BASE_PROPS: CodexFormFieldsProps = {
  codexApiKey: "sk-test",
  onApiKeyChange: vi.fn(),
  category: "third_party",
  shouldShowApiKeyLink: false,
  websiteUrl: "",
  codexBaseUrl: "https://api.example.com",
  onBaseUrlChange: vi.fn(),
  isFullUrl: false,
  onFullUrlChange: vi.fn(),
  isEndpointModalOpen: false,
  onEndpointModalToggle: vi.fn(),
  autoSelect: false,
  onAutoSelectChange: vi.fn(),
  codexModel: "",
  onModelChange: vi.fn(),
  apiFormat: "openai_responses",
  onApiFormatChange: vi.fn(),
  anthropicAuthField: "ANTHROPIC_AUTH_TOKEN",
  onAnthropicAuthFieldChange: vi.fn(),
  impersonateClaudeCode: false,
  onImpersonateClaudeCodeChange: vi.fn(),
  maxOutputTokens: "",
  onMaxOutputTokensChange: vi.fn(),
  promptCacheRouting: "auto",
  onPromptCacheRoutingChange: vi.fn(),
  speedTestEndpoints: [],
  customUserAgent: "",
  onCustomUserAgentChange: vi.fn(),
  localProxyHeadersOverride: "",
  onLocalProxyHeadersOverrideChange: vi.fn(),
  localProxyBodyOverride: "",
  onLocalProxyBodyOverrideChange: vi.fn(),
  shouldShowSpeedTest: false,
};

// harness 自己持有 Body 覆盖状态（真实用户流程：组件把新值写回父级），
// 并把当前值渲染到一个 output 里，便于断言——不必依赖高级区是否展开。
function renderForm(options: {
  catalog: CodexCatalogModel[];
  bodyOverride?: string;
}) {
  const onCatalogModelsChange = vi.fn();

  function Harness() {
    const [body, setBody] = useState(options.bodyOverride ?? "");

    return (
      <FormShell>
        <CodexFormFields
          {...BASE_PROPS}
          catalogModels={options.catalog}
          onCatalogModelsChange={onCatalogModelsChange}
          localProxyBodyOverride={body}
          onLocalProxyBodyOverrideChange={setBody}
        />
        <output data-testid={BODY_OUTPUT_TESTID}>{body}</output>
      </FormShell>
    );
  }

  render(<Harness />);
  return { onCatalogModelsChange };
}

const bodyOverride = () => screen.getByTestId(BODY_OUTPUT_TESTID).textContent;
const modelOverrideSwitch = () =>
  screen.getByRole("switch", { name: SWITCH_NAME });
const firstRowModelInput = () =>
  screen.getAllByPlaceholderText(ROW_MODEL_PLACEHOLDER)[0] as HTMLInputElement;

const asJson = (value: Record<string, unknown>) =>
  JSON.stringify(value, null, 2);

describe("CodexFormFields model override switch", () => {
  it("勾选后把第一行模型写进 Body 覆盖", () => {
    renderForm({ catalog: [{ model: "gpt-a" }] });
    expect(bodyOverride()).toBe("");

    fireEvent.click(modelOverrideSwitch());

    expect(bodyOverride()).toBe(asJson({ model: "gpt-a" }));
  });

  it("取消勾选只删 model 键，保留其它键", () => {
    renderForm({
      catalog: [{ model: "gpt-a" }],
      bodyOverride: asJson({ temperature: 0.2 }),
    });

    fireEvent.click(modelOverrideSwitch());
    expect(JSON.parse(bodyOverride()!)).toEqual({
      temperature: 0.2,
      model: "gpt-a",
    });

    fireEvent.click(modelOverrideSwitch());
    expect(JSON.parse(bodyOverride()!)).toEqual({ temperature: 0.2 });
  });

  // 回归用例：旧实现把守卫写成 `!modelOverrideChecked`，而第一行一变该值必然为 false，
  // 导致这段 effect 永不执行，Body 覆盖停在旧模型名。
  it("勾选状态下改第一行模型名，Body 覆盖自动跟随", async () => {
    renderForm({ catalog: [{ model: "gpt-a" }] });
    fireEvent.click(modelOverrideSwitch());
    expect(JSON.parse(bodyOverride()!)).toEqual({ model: "gpt-a" });

    fireEvent.change(firstRowModelInput(), { target: { value: "gpt-b" } });

    await waitFor(() => {
      expect(JSON.parse(bodyOverride()!)).toEqual({ model: "gpt-b" });
    });
  });

  it("没勾选时改第一行模型名不会碰 Body 覆盖", async () => {
    renderForm({
      catalog: [{ model: "gpt-a" }],
      bodyOverride: asJson({ temperature: 0.2 }),
    });

    fireEvent.change(firstRowModelInput(), { target: { value: "gpt-b" } });

    await waitFor(() => {
      expect(firstRowModelInput().value).toBe("gpt-b");
    });
    expect(JSON.parse(bodyOverride()!)).toEqual({ temperature: 0.2 });
  });

  it("第一行留空时禁用开关并给出提示", () => {
    renderForm({ catalog: [] });

    expect(modelOverrideSwitch()).toBeDisabled();
    expect(screen.getByText(EMPTY_HINT)).toBeVisible();
  });

  it("Body 覆盖是半截 JSON 时点开关，不冲掉已输入的内容", () => {
    renderForm({
      catalog: [{ model: "gpt-a" }],
      bodyOverride: '{"temperature"',
    });

    fireEvent.click(modelOverrideSwitch());

    expect(bodyOverride()).toBe('{"temperature"');
  });
});
