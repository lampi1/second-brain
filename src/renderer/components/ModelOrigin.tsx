// Historical brain records and session aggregates do not carry event-level model provenance.
// Never borrow the current profile/model to fill that gap; human authors have no AI model.
import{t}from'../i18n';
export function ModelOrigin({human=false}:{human?:boolean}){
 return <small className="model-origin" title={human?undefined:t('origin.missingHint')} data-testid="model-origin">{human?t('origin.user'):`${t('product.model')}: ${t('origin.unavailable')}`}</small>;
}
