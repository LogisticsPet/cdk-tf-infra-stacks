import { ISynthesisSession, StackManifest, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { addCustomSynthesis } from 'cdktf/lib/synthesize/synthesizer';

/**
 * https://github.com/hashicorp/terraform-cdk/issues/2976
 */
export default abstract class CustomTerraformStack extends TerraformStack {
  public constructor(scope: Construct, id: string) {
    // Inherit from the base terraform stack
    super(scope, id);

    // Inject a custom synthesis function
    addCustomSynthesis(this, {
      onSynthesize: this.customSynthesis.bind(this),
    });

    return;
  }

  /**
   * Overrides the stack manifest's dependencies attribute.
   *
   * @param session - Single session of synthesis.
   */
  private customSynthesis(session: ISynthesisSession): void {
    // Create a type modifier and make the stack manifest mutable
    type MutableStackManifest = {
      -readonly [K in keyof StackManifest]: StackManifest[K];
    };

    // Get the manifest and make a mutable shallow copy
    const manifestImmutable: StackManifest = session.manifest.forStack(this);
    const manifestMutable: MutableStackManifest = manifestImmutable;

    // Override the manifest's dependency references
    manifestMutable.dependencies = this.dependencies.map(
      (item) => item.node.id
    );

    return;
  }
}
