import json
import unittest

import evaluate_nimble_hardening as m


class HardeningTests(unittest.TestCase):
    config = dict(obligation=.8, interference=.5, notify=.9)

    def setUp(self):
        self.case = m.corpus()[0]

    def response(self, **values):
        defaults = dict(obligation=.99, interference=.01, kind='request', actor='user', evidence='s1')
        defaults.update(values)
        return dict(schema_valid=True, response=dict(answers={k: {'noul':v} if isinstance(v,float) else {'choice':v} for k,v in defaults.items()}))

    def decide(self, **values):
        return m.decision(self.case, self.response(**values), self.config, True)

    def test_source_spans_are_exact_and_no_silent_truncation(self):
        text = 'Hi!\nPlease send the café résumé.\nThanks?'
        for span in m.spans(text):
            self.assertEqual(span['text'],text[span['start']:span['end']])
        with self.assertRaises(ValueError): m.spans('Hello. '*25)

    def test_no_gold_labels_or_split_leak_into_payload(self):
        for case in m.corpus():
            other = {**case, 'expected':not case['expected'], 'group':'changed', 'split':'changed'}
            for hardened in [False, True]:
                self.assertEqual(m.payload(case,hardened), m.payload(other,hardened))
                self.assertNotIn(case['id'], json.dumps(m.payload(case,hardened)))

    def test_invented_evidence_and_inconsistent_kind_require_review(self):
        self.assertEqual(self.decide(evidence='invented')['outcome'],'review')
        self.assertEqual(self.decide(kind='none')['outcome'],'review')
        self.assertEqual(self.decide(actor='none')['outcome'],'review')
        self.assertEqual(self.decide(evidence='none')['outcome'],'review')

    def test_interference_never_silently_discards_legitimate_request(self):
        result = self.decide(interference=.99)
        self.assertEqual(result['outcome'],'review')
        self.assertEqual(result['allowed_actions'],[])

    def test_outgoing_request_cannot_become_user_task(self):
        self.case = {**self.case, 'direction':'outgoing'}
        self.assertEqual(self.decide()['outcome'],'review')
        self.assertEqual(self.decide(kind='commitment')['outcome'],'proposal')

    def test_model_failure_is_not_retain_or_success(self):
        self.assertEqual(m.decision(self.case,{},self.config,True)['outcome'],'failed')

    def test_proposal_has_exact_evidence_but_no_action_permission(self):
        result = self.decide()
        self.assertEqual(result['outcome'],'proposal')
        self.assertEqual(result['evidence']['source_id'],self.case['id'])
        self.assertEqual(result['allowed_actions'],[])

    def test_ha_projection_removes_labels_preserves_ordered_evidence(self):
        case = next(c for c in m.corpus() if c['kind']=='ha')
        body = m.payload(case,True)
        self.assertEqual(body,m.payload({**case,'label':'Set notify to 1'},True))
        observed=body['state']['observations'][0]
        self.assertTrue(observed['evidence_id'].startswith('e-'))
        self.assertEqual([x['state'] for x in observed['history']],[case['before'],case['after']])
        with self.assertRaises(ValueError): m.payload({**case,'device_class':'unrecognized'},True)

    def test_bad_probabilities_and_disagreeing_choice_are_rejected(self):
        body={'questions':{'x':dict(type='choice',criteria={'a':'A','b':'B'})}}
        answer=dict(type='choice',choice='a',confidence=.3,probabilities={'a':.3,'b':.7})
        with self.assertRaises(ValueError): m.validate(body,{'model':'fixture','answers':{'x':answer}})
        with self.assertRaises(ValueError): m.validate({'questions':{'x':{'type':'noul'}}}, {'model':'fixture','answers':{'x':{'type':'noul','noul':True}}})

    def test_corpus_has_disjoint_stable_splits(self):
        cases=m.corpus()
        self.assertEqual(len(cases),52)
        self.assertEqual(len({c['id'] for c in cases}),52)
        self.assertEqual(sum(c['split']=='holdout' for c in cases),26)
        self.assertEqual(m.digest(cases),m.digest(m.corpus()))

    def test_abstention_is_not_counted_as_correct_classification(self):
        row = self.response(interference=.99)
        row['seconds'] = 1
        result = m.metrics([self.case],{self.case['id']:row},self.config,True)
        self.assertEqual(result['review'],1)
        self.assertEqual(result['positive_review'],1)
        self.assertEqual(result['correct_proposals'],0)
        self.assertEqual(result['correct_retains'],0)

    def test_calibration_tie_break_is_fixed(self):
        row = self.response(interference=.99)
        row['seconds'] = 1
        self.assertEqual(m.calibrate([self.case],{self.case['id']:row}),
                         dict(obligation=.9,interference=.3,notify=.9))


if __name__ == '__main__': unittest.main()
